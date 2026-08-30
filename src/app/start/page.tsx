import Image from 'next/image'
import Link from 'next/link'

const TRUST_POINTS = [
  'บัญชีคู่บังคับที่ระดับฐานข้อมูล',
  'เอกสารที่โพสต์แล้วแก้ไขไม่ได้',
  'Multi-tenant ด้วย PostgreSQL RLS',
  'OpenAPI ครบทุก endpoint',
]

const STATS = [
  { value: '6', label: 'กลุ่มงานหลัก ครบในระบบเดียว' },
  { value: '4', label: 'รายงานการเงิน real-time' },
  { value: '7', label: 'ชนิดเอกสารรันเลขอัตโนมัติ' },
  { value: '30+', label: 'กฎบัญชีที่ฐานข้อมูลบังคับเอง' },
]

const FINANCE_ITEMS = [
  { title: 'บัญชีแยกประเภท (GL)', body: 'ผังบัญชี งวดบัญชี journal บัญชีคู่ พร้อมปิดงวดเข้ากำไรสะสมอัตโนมัติ' },
  { title: 'เจ้าหนี้ (AP)', body: 'บิลผู้ขาย → โพสต์ → จ่ายชำระตัดยอดรายบิล กันจ่ายเกินและแก้ย้อนหลัง' },
  { title: 'ลูกหนี้ (AR)', body: 'ดึง invoice จากงานขายเข้าบัญชีแบบ batch แยกภาษีขาย และรับชำระตัดยอดรายใบ' },
  { title: 'รายงานการเงิน', body: 'Trial Balance · งบกำไรขาดทุน · งบแสดงฐานะการเงิน · อายุหนี้ AP/AR' },
]

const SUITES = [
  {
    icon: '🛒',
    title: 'งานขายและปฏิบัติการ',
    items: ['CRM ลูกค้า/ดีล/ไปป์ไลน์', 'ใบเสนอราคา · คำสั่งขาย · ใบแจ้งหนี้', 'แคตตาล็อกสินค้าและราคา', 'คลังสินค้า (WMS) ครบวงจร'],
  },
  {
    icon: '👥',
    title: 'บุคลากรและเงินเดือน',
    items: ['ทะเบียนพนักงานบน Party กลาง', 'Payroll คำนวณด้วย Rust engine', 'ประกันสังคม + ภาษีหัก ณ ที่จ่าย', 'โพสต์เงินเดือนเข้าบัญชีอัตโนมัติ'],
  },
  {
    icon: '⚙️',
    title: 'แพลตฟอร์ม',
    items: ['AI Assistant ในระบบ (Ctrl+L)', 'สิทธิ์ผู้ใช้ละเอียดระดับฟีเจอร์ (RBAC)', 'Custom fields ทุก entity', 'รองรับ 5 ภาษา + API มาตรฐาน'],
  },
]

const ARCH_POINTS = [
  {
    title: 'ความถูกต้องทางบัญชีที่พิสูจน์ได้',
    body: 'ทุก journal ต้องดุลก่อนโพสต์ งวดที่ปิดรับรายการใหม่ไม่ได้ และเอกสารที่โพสต์แล้วถูกล็อกด้วย database trigger — ต่อให้โค้ดหรือ SQL ตรงก็แก้ไม่ได้',
  },
  {
    title: 'ความปลอดภัยของข้อมูลหลายองค์กร',
    body: 'ข้อมูลแยกต่อผู้เช่าด้วย Row-Level Security ของ PostgreSQL เป็นชั้นป้องกันใต้แอปพลิเคชัน พร้อม audit log ก่อน/หลังการแก้ไขทุกรายการ',
  },
  {
    title: 'สถาปัตยกรรมที่ขยายได้',
    body: 'โมดูลาร์ทั้งระบบ — เพิ่มโมดูล ฟิลด์ หน้าจอ และ workflow ได้โดยไม่แก้แกนกลาง งานคำนวณหนักแยกเป็น service ภาษา Rust ที่ผ่าน unit test',
  },
]

export default function OrvaStartPage() {
  return (
    <main className="min-h-svh w-full bg-background text-foreground">
      {/* Top navigation */}
      <header className="sticky top-0 z-20 border-b bg-background/90 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-6">
          <div className="flex items-center gap-2.5">
            <Image src="/orva.svg" alt="Orva" width={30} height={30} />
            <span className="text-lg font-bold tracking-tight">Orva</span>
          </div>
          <nav className="hidden items-center gap-6 text-sm text-muted-foreground md:flex">
            <a href="#modules" className="hover:text-foreground">โมดูล</a>
            <a href="#screens" className="hover:text-foreground">ภาพระบบ</a>
            <a href="#architecture" className="hover:text-foreground">สถาปัตยกรรม</a>
          </nav>
          <Link
            href="/login"
            className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:opacity-90"
          >
            เข้าสู่ระบบ
          </Link>
        </div>
      </header>

      <div className="mx-auto flex max-w-6xl flex-col gap-20 px-6 pb-20">
        {/* Hero */}
        <section className="flex flex-col items-center gap-6 pt-16 text-center">
          <span className="rounded-full border px-3 py-1 text-xs text-muted-foreground">
            Orva ERP · by Anthovai
          </span>
          <h1 className="max-w-3xl text-4xl font-bold leading-tight tracking-tight sm:text-5xl">
            ERP ครบวงจรสำหรับธุรกิจไทย
            <span className="block text-primary">ที่ความถูกต้องทางบัญชีถูกบังคับถึงระดับฐานข้อมูล</span>
          </h1>
          <p className="max-w-2xl text-base leading-7 text-muted-foreground">
            การเงินและบัญชี งานขาย คลังสินค้า และเงินเดือน — เชื่อมถึงกันในระบบเดียว
            ทุกเอกสารไหลเข้าบัญชีแยกประเภทโดยอัตโนมัติ ปิดงวดได้จริง ตรวจสอบย้อนหลังได้ทุกรายการ
          </p>
          <div className="flex gap-3">
            <Link
              href="/login"
              className="rounded-md bg-primary px-6 py-3 text-sm font-semibold text-primary-foreground hover:opacity-90"
            >
              เริ่มใช้งาน
            </Link>
            <a
              href="#screens"
              className="rounded-md border px-6 py-3 text-sm font-semibold hover:bg-accent"
            >
              ดูภาพระบบ
            </a>
          </div>
          <ul className="flex flex-wrap justify-center gap-x-6 gap-y-2 text-xs text-muted-foreground">
            {TRUST_POINTS.map((point) => (
              <li key={point} className="flex items-center gap-1.5">
                <span className="text-primary">✓</span>
                {point}
              </li>
            ))}
          </ul>
        </section>

        {/* Stats */}
        <section className="grid grid-cols-2 gap-4 rounded-xl border bg-card px-6 py-8 md:grid-cols-4">
          {STATS.map((stat) => (
            <div key={stat.label} className="text-center">
              <div className="text-3xl font-bold text-primary tabular-nums">{stat.value}</div>
              <div className="mt-1 text-xs leading-5 text-muted-foreground">{stat.label}</div>
            </div>
          ))}
        </section>

        {/* Modules */}
        <section id="modules" className="flex flex-col gap-8 scroll-mt-20">
          <div className="text-center">
            <h2 className="text-2xl font-bold">โมดูลครบทุกงานหลักขององค์กร</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              การเงินคือแกนกลาง — ทุกโมดูลส่งข้อมูลเข้าบัญชีแยกประเภทเดียวกัน
            </p>
          </div>

          <div className="rounded-xl border-2 border-primary/30 bg-card p-6">
            <div className="mb-4 flex items-center gap-2">
              <span className="text-2xl">🏛️</span>
              <h3 className="text-lg font-semibold">การเงินและบัญชี</h3>
              <span className="rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-medium text-primary">แกนกลางของระบบ</span>
            </div>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {FINANCE_ITEMS.map((item) => (
                <div key={item.title}>
                  <h4 className="text-sm font-semibold">{item.title}</h4>
                  <p className="mt-1 text-xs leading-5 text-muted-foreground">{item.body}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-3">
            {SUITES.map((suite) => (
              <div key={suite.title} className="rounded-xl border bg-card p-6">
                <div className="mb-3 flex items-center gap-2">
                  <span className="text-xl">{suite.icon}</span>
                  <h3 className="text-base font-semibold">{suite.title}</h3>
                </div>
                <ul className="flex flex-col gap-2 text-sm text-muted-foreground">
                  {suite.items.map((item) => (
                    <li key={item} className="flex items-start gap-2">
                      <span className="mt-0.5 text-primary">•</span>
                      {item}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </section>

        {/* Screenshots */}
        <section id="screens" className="flex flex-col gap-10 scroll-mt-20">
          <div className="text-center">
            <h2 className="text-2xl font-bold">ภาพตัวอย่างระบบ</h2>
          </div>
          <div className="grid items-start gap-10 lg:grid-cols-2">
            <figure className="flex flex-col gap-3">
              <div className="overflow-hidden rounded-xl border shadow-sm">
                <Image src="/marketing/mock-finance.svg" alt="หน้างบการเงินของ Orva" width={960} height={560} className="w-full" />
              </div>
              <figcaption className="text-sm text-muted-foreground">
                <span className="font-medium text-foreground">งบการเงิน real-time</span> — งบกำไรขาดทุนและงบแสดงฐานะการเงิน
                คำนวณสดจาก journal ที่โพสต์แล้ว สมการบัญชีลงตัวเสมอ
              </figcaption>
            </figure>
            <figure className="flex flex-col gap-3">
              <div className="overflow-hidden rounded-xl border shadow-sm">
                <Image src="/marketing/mock-payroll.svg" alt="หน้าเงินเดือนของ Orva" width={960} height={560} className="w-full" />
              </div>
              <figcaption className="text-sm text-muted-foreground">
                <span className="font-medium text-foreground">เงินเดือนโปร่งใสรายคน</span> — คำนวณด้วย Rust engine
                (ประกันสังคม + ภาษีหัก ณ ที่จ่าย) แล้วโพสต์เข้าบัญชีเป็น journal ที่ดุลเสมอ
              </figcaption>
            </figure>
          </div>
        </section>

        {/* Architecture / trust */}
        <section id="architecture" className="flex flex-col gap-8 scroll-mt-20">
          <div className="text-center">
            <h2 className="text-2xl font-bold">สร้างมาเพื่อความน่าเชื่อถือระดับงานบัญชี</h2>
          </div>
          <div className="grid gap-4 md:grid-cols-3">
            {ARCH_POINTS.map((point) => (
              <div key={point.title} className="rounded-xl border bg-card p-6">
                <h3 className="text-sm font-semibold">{point.title}</h3>
                <p className="mt-2 text-xs leading-5 text-muted-foreground">{point.body}</p>
              </div>
            ))}
          </div>
          <p className="text-center text-xs text-muted-foreground">
            PostgreSQL · Next.js/TypeScript · Rust · สร้างบน Open Mercato (MIT)
          </p>
        </section>

        {/* Final CTA */}
        <section className="flex flex-col items-center gap-4 rounded-xl border bg-card px-6 py-12 text-center">
          <h2 className="text-2xl font-bold">พร้อมเริ่มใช้ Orva แล้วหรือยัง</h2>
          <p className="max-w-xl text-sm text-muted-foreground">
            เข้าสู่ระบบเพื่อจัดการบัญชี งานขาย คลังสินค้า และเงินเดือนของคุณจากที่เดียว
          </p>
          <Link
            href="/login"
            className="rounded-md bg-primary px-8 py-3 text-sm font-semibold text-primary-foreground hover:opacity-90"
          >
            เข้าสู่ระบบ
          </Link>
        </section>
      </div>

      {/* Footer */}
      <footer className="border-t">
        <div className="mx-auto grid max-w-6xl gap-8 px-6 py-10 text-sm sm:grid-cols-2 md:grid-cols-4">
          <div>
            <div className="flex items-center gap-2">
              <Image src="/orva.svg" alt="Orva" width={26} height={26} />
              <span className="font-bold">Orva</span>
            </div>
            <p className="mt-2 text-xs leading-5 text-muted-foreground">
              ระบบ ERP ครบวงจรสำหรับธุรกิจไทย โดย Anthovai
            </p>
          </div>
          <div>
            <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">ผลิตภัณฑ์</div>
            <ul className="mt-2 flex flex-col gap-1.5 text-muted-foreground">
              <li><a href="#modules" className="hover:text-foreground">โมดูลทั้งหมด</a></li>
              <li><a href="#screens" className="hover:text-foreground">ภาพระบบ</a></li>
              <li><a href="#architecture" className="hover:text-foreground">สถาปัตยกรรม</a></li>
            </ul>
          </div>
          <div>
            <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">เริ่มใช้งาน</div>
            <ul className="mt-2 flex flex-col gap-1.5 text-muted-foreground">
              <li><Link href="/login" className="hover:text-foreground">เข้าสู่ระบบ</Link></li>
              <li><Link href="/backend" className="hover:text-foreground">หน้าจัดการ</Link></li>
              <li><a href="/api/docs/openapi" className="hover:text-foreground">API (OpenAPI)</a></li>
            </ul>
          </div>
          <div>
            <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">บริษัท</div>
            <ul className="mt-2 flex flex-col gap-1.5 text-muted-foreground">
              <li>Anthovai</li>
              <li><a href="https://github.com/anthovai/orva-erp" className="hover:text-foreground">GitHub</a></li>
            </ul>
          </div>
        </div>
        <div className="border-t py-4 text-center text-xs text-muted-foreground">
          © 2026 Anthovai · Orva ERP · สร้างบน Open Mercato (MIT)
        </div>
      </footer>
    </main>
  )
}
