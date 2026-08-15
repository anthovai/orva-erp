//! ส่งอีเมลจริงทาง SMTP (ADR 0008) — abstraction แคบ ๆ เพื่อให้ test แทนที่ได้
//!
//! trait ใช้ boxed future (ไม่ใช่ `async fn`) เพราะต้องอยู่ใน `Arc<dyn Mailer>`
//! ข้าม thread — pattern เดียวกับ `orva_module_sdk::Module`

use std::future::Future;
use std::pin::Pin;
use std::time::Duration;

use lettre::message::Mailbox;
use lettre::transport::smtp::authentication::Credentials;
use lettre::{AsyncSmtpTransport, AsyncTransport, Message, Tokio1Executor};
use orva_error::{Error, Result};

pub struct EmailMessage {
    pub to: String,
    pub subject: String,
    pub body: String,
}

pub trait Mailer: Send + Sync {
    fn send(&self, message: EmailMessage) -> Pin<Box<dyn Future<Output = Result<()>> + Send + '_>>;
}

#[derive(Clone)]
pub struct SmtpConfig {
    pub host: String,
    pub port: u16,
    pub username: Option<String>,
    pub password: Option<String>,
    /// ที่อยู่ผู้ส่ง เช่น `ORVA <no-reply@example.com>`
    pub from: String,
    /// STARTTLS (มาตรฐาน production) — ปิดได้เฉพาะ dev เช่น Mailpit ที่ไม่มี TLS
    pub tls: bool,
}

pub struct SmtpMailer {
    transport: AsyncSmtpTransport<Tokio1Executor>,
    from: Mailbox,
}

const SEND_TIMEOUT: Duration = Duration::from_secs(10);

impl SmtpMailer {
    pub fn new(config: SmtpConfig) -> Result<Self> {
        let from: Mailbox = config
            .from
            .parse()
            .map_err(|e| Error::Config(format!("invalid smtp from address: {e}")))?;

        let mut builder = if config.tls {
            // relay = STARTTLS บน port ที่กำหนด (ค่าปกติ 587)
            AsyncSmtpTransport::<Tokio1Executor>::starttls_relay(&config.host)
                .map_err(|e| Error::Config(format!("smtp relay config failed: {e}")))?
        } else {
            AsyncSmtpTransport::<Tokio1Executor>::builder_dangerous(&config.host)
        };
        builder = builder.port(config.port).timeout(Some(SEND_TIMEOUT));

        if let (Some(username), Some(password)) = (config.username, config.password) {
            builder = builder.credentials(Credentials::new(username, password));
        }

        Ok(Self {
            transport: builder.build(),
            from,
        })
    }
}

impl Mailer for SmtpMailer {
    fn send(&self, message: EmailMessage) -> Pin<Box<dyn Future<Output = Result<()>> + Send + '_>> {
        Box::pin(async move {
            let email = Message::builder()
                .from(self.from.clone())
                .to(message
                    .to
                    .parse()
                    .map_err(|e| Error::Validation(format!("invalid recipient: {e}")))?)
                .subject(&message.subject)
                .body(message.body)
                .map_err(|e| Error::Internal(format!("build email failed: {e}")))?;

            self.transport
                .send(email)
                .await
                .map_err(|e| Error::Internal(format!("smtp send failed: {e}")))?;
            Ok(())
        })
    }
}
