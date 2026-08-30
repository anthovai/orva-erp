import Image from 'next/image'
import Link from 'next/link'

const FEATURES: Array<{ icon: string; title: string; body: string }> = [
  {
    icon: '📚',
    title: 'บัญชีแยกประเภท (GL)',
    body: 'ผังบัญชี งวดบัญชี และ journal แบบ double-entry — เอกสารที่โพสต์แล้วแก้ไขไม่ได้ บังคับที่ระดับฐานข้อมูล',
  },
  {
    icon: '🧾',
    title: 'เจ้าหนี้ (AP)',
    body: 'บิลผู้ขาย → โพสต์เข้าบัญชี → จ่ายชำระตัดยอดรายบิล พร้อมกันจ่ายเกินและกันแก้เอกสารย้อนหลัง',
  },
  {
    icon: '💵',
    title: 'ลูกหนี้ (AR)',
    body: 'ดึง invoice จากระบบขายเข้าบัญชีแบบ batch แยกภาษีขายอัตโนมัติ และรับชำระตัดยอดรายใบ',
  },
  {
    icon: '📊',
    title: 'รายงานการเงิน',
    body: 'Trial Balance, งบกำไรขาดทุน, งบแสดงฐานะการเงิน และรายงานอายุหนี้ AP/AR แบบ real-time',
  },
  {
    icon: '🦀',
    title: 'Payroll (Rust engine)',
    body: 'คำนวณเงินเดือน ประกันสังคม และภาษีหัก ณ ที่จ่าย ด้วย engine ภาษา Rust ที่ผ่าน unit test แล้วโพสต์เข้าบัญชีอัตโนมัติ',
  },
  {
    icon: '🤝',
    title: 'Party กลาง + CRM/ขาย/คลัง',
    body: 'บุคคล/บริษัทเดียวเป็นได้ทั้งลูกค้า ผู้ขาย และพนักงาน — ต่อยอดจาก CRM, Sales และ WMS ที่มีมาให้ครบ',
  },
  {
    icon: '🤖',
    title: 'AI Assistant',
    body: 'ผู้ช่วย AI ในระบบ (Ctrl+L) ค้นข้อมูล ตอบคำถาม และทำงานผ่านเครื่องมือที่ถูกคุมสิทธิ์ต่อผู้ใช้',
  },
  {
    icon: '🔐',
    title: 'Multi-tenant + RLS',
    body: 'แยกข้อมูลต่อองค์กรด้วย Row-Level Security ของ PostgreSQL — ป้องกันข้ามผู้เช่าที่ชั้นฐานข้อมูลเอง',
  },
]

const FLOW = ['ผังบัญชี', 'งวดบัญชี', 'บิล / Invoice / เงินเดือน', 'โพสต์เข้า GL', 'รับ–จ่ายชำระ', 'งบการเงิน + ปิดงวด']

export default function OrvaStartPage() {
  return (
    <main className="min-h-svh w-full bg-background text-foreground">
      <div className="mx-auto flex max-w-5xl flex-col gap-14 px-6 py-14">
        <header className="flex flex-col items-center gap-5 text-center">
          <Image src="/orva.svg" alt="Orva" width={88} height={88} priority />
          <div>
            <h1 className="text-4xl font-bold tracking-tight">Orva</h1>
            <p className="mt-1 text-lg text-muted-foreground">ระบบ ERP สำหรับธุรกิจไทย โดย Anthovai</p>
          </div>
          <p className="max-w-2xl text-sm leading-6 text-muted-foreground">
            Orva รวมงานบัญชี การเงิน งานขาย คลังสินค้า และเงินเดือนไว้ในระบบเดียว
            สร้างบนสถาปัตยกรรมโมดูลาร์แบบ multi-tenant — ทุกเอกสารการเงินผ่านกฎบัญชีคู่
            ที่ถูกบังคับถึงระดับฐานข้อมูล และมี AI ผู้ช่วยในตัว
          </p>
          <div className="flex gap-3">
            <Link
              href="/login"
              className="rounded-md bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground hover:opacity-90"
            >
              เข้าสู่ระบบ
            </Link>
            <Link
              href="/backend"
              className="rounded-md border px-5 py-2.5 text-sm font-semibold hover:bg-accent"
            >
              เปิดหน้าจัดการ
            </Link>
          </div>
        </header>

        <section className="flex flex-col gap-3">
          <h2 className="text-center text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            วงจรบัญชีครบตั้งแต่ต้นจนปิดงวด
          </h2>
          <div className="flex flex-wrap items-center justify-center gap-2 text-sm">
            {FLOW.map((step, index) => (
              <span key={step} className="flex items-center gap-2">
                <span className="rounded-full border bg-card px-3 py-1.5">{step}</span>
                {index < FLOW.length - 1 ? <span className="text-muted-foreground">→</span> : null}
              </span>
            ))}
          </div>
        </section>

        <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {FEATURES.map((feature) => (
            <div key={feature.title} className="rounded-lg border bg-card p-4">
              <div className="text-2xl">{feature.icon}</div>
              <h3 className="mt-2 text-sm font-semibold">{feature.title}</h3>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">{feature.body}</p>
            </div>
          ))}
        </section>

        <section className="flex flex-col gap-10">
          <div className="flex flex-col gap-3">
            <h2 className="text-xl font-semibold">ภาพตัวอย่างระบบ — งบการเงิน</h2>
            <p className="max-w-2xl text-sm text-muted-foreground">
              งบกำไรขาดทุนและงบแสดงฐานะการเงินคำนวณสดจาก journal ที่โพสต์แล้ว
              พร้อมบรรทัดกำไรสะสมอัตโนมัติ — สมการบัญชีลงตัวเสมอโดยไม่ต้องปิดงวดก่อน
            </p>
            <div className="overflow-hidden rounded-xl border shadow-sm">
              <Image src="/marketing/mock-finance.svg" alt="ตัวอย่างหน้างบการเงินของ Orva" width={960} height={560} className="w-full" />
            </div>
          </div>
          <div className="flex flex-col gap-3">
            <h2 className="text-xl font-semibold">ภาพตัวอย่างระบบ — เงินเดือนด้วย Rust engine</h2>
            <p className="max-w-2xl text-sm text-muted-foreground">
              Payroll run คำนวณผ่าน sidecar ภาษา Rust (ประกันสังคม 5% เพดาน 750 บาท และภาษีหัก ณ ที่จ่ายรายคน)
              แล้วโพสต์เข้าบัญชีเป็น journal เดียวที่ดุลเสมอ
            </p>
            <div className="overflow-hidden rounded-xl border shadow-sm">
              <Image src="/marketing/mock-payroll.svg" alt="ตัวอย่างหน้าเงินเดือนของ Orva" width={960} height={560} className="w-full" />
            </div>
          </div>
        </section>

        <footer className="border-t pt-6 text-center text-xs text-muted-foreground">
          Orva by Anthovai · สร้างบน Open Mercato (MIT) · PostgreSQL RLS · Rust payroll engine · AI-ready
        </footer>
      </div>
    </main>
  )
}
