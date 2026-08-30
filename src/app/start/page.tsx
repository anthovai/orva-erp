import Image from 'next/image'
import Link from 'next/link'
import { IBM_Plex_Sans_Thai } from 'next/font/google'
import {
  ArrowRight,
  BarChart3,
  Bot,
  Check,
  FileText,
  Landmark,
  Lock,
  Package,
  ShieldCheck,
  Users,
  Wallet,
} from 'lucide-react'

const plexThai = IBM_Plex_Sans_Thai({
  weight: ['400', '500', '600', '700'],
  subsets: ['thai', 'latin'],
  display: 'swap',
})

// Brand palette (matches the Orva logomark)
const BRAND = {
  deep: '#0A3D33',
  dark: '#0E4A3E',
  base: '#11836E',
  mint: '#7EE0C4',
}

const TRUST_POINTS = [
  'บัญชีคู่บังคับที่ระดับฐานข้อมูล',
  'เอกสารที่โพสต์แล้วแก้ไขไม่ได้',
  'แยกข้อมูลด้วย PostgreSQL RLS',
  'รองรับภาษาไทยทั้งระบบ',
]

const STATS = [
  { value: '6', label: 'กลุ่มงานหลักในระบบเดียว' },
  { value: '4', label: 'รายงานการเงิน real-time' },
  { value: '17,000+', label: 'ข้อความ UI ภาษาไทย' },
  { value: '30+', label: 'กฎบัญชีที่ฐานข้อมูลบังคับ' },
]

const FINANCE_ITEMS = [
  { icon: Landmark, title: 'บัญชีแยกประเภท (GL)', body: 'ผังบัญชี งวดบัญชี journal บัญชีคู่ และปิดงวดเข้ากำไรสะสมอัตโนมัติ' },
  { icon: FileText, title: 'เจ้าหนี้ (AP)', body: 'บิลผู้ขาย → โพสต์ → จ่ายชำระตัดยอดรายบิล กันจ่ายเกินและแก้ย้อนหลัง' },
  { icon: Wallet, title: 'ลูกหนี้ (AR)', body: 'ดึง invoice จากงานขายเข้าบัญชี แยกภาษีขาย และรับชำระตัดยอดรายใบ' },
  { icon: BarChart3, title: 'รายงานการเงิน', body: 'งบทดลอง งบกำไรขาดทุน งบแสดงฐานะการเงิน และอายุหนี้ AP/AR' },
]

const SUITES = [
  {
    icon: Package,
    title: 'งานขายและปฏิบัติการ',
    items: ['CRM ลูกค้า · ดีล · ไปป์ไลน์', 'ใบเสนอราคา · คำสั่งขาย · ใบแจ้งหนี้', 'แคตตาล็อกสินค้าและราคา', 'คลังสินค้า (WMS) ครบวงจร'],
  },
  {
    icon: Users,
    title: 'บุคลากรและเงินเดือน',
    items: ['ทะเบียนพนักงานบน Party กลาง', 'Payroll คำนวณด้วย Rust engine', 'ประกันสังคม + ภาษีหัก ณ ที่จ่าย', 'โพสต์เงินเดือนเข้าบัญชีอัตโนมัติ'],
  },
  {
    icon: Bot,
    title: 'แพลตฟอร์มและ AI',
    items: ['AI Assistant ในระบบ (Ctrl+L)', 'สิทธิ์ละเอียดระดับฟีเจอร์ (RBAC)', 'Custom fields ทุก entity', 'ภาษาไทยเต็มระบบ + OpenAPI'],
  },
]

const ARCH_POINTS = [
  {
    icon: ShieldCheck,
    title: 'ความถูกต้องที่พิสูจน์ได้',
    body: 'ทุก journal ต้องดุลก่อนโพสต์ งวดที่ปิดรับรายการใหม่ไม่ได้ และเอกสารที่โพสต์แล้วถูกล็อกด้วย database trigger — ต่อให้เขียน SQL ตรงก็แก้ไม่ได้',
  },
  {
    icon: Lock,
    title: 'ปลอดภัยระดับฐานข้อมูล',
    body: 'ข้อมูลแยกต่อองค์กรด้วย Row-Level Security ของ PostgreSQL เป็นชั้นป้องกันใต้แอปพลิเคชัน พร้อม audit log ก่อน/หลังทุกการแก้ไข',
  },
  {
    icon: Bot,
    title: 'สถาปัตยกรรมที่ขยายได้',
    body: 'โมดูลาร์ทั้งระบบ เพิ่มโมดูลและฟิลด์ได้โดยไม่แก้แกนกลาง งานคำนวณหนักแยกเป็น service ภาษา Rust ที่ผ่าน unit test',
  },
]

function BrowserFrame({ src, alt }: { src: string; alt: string }) {
  return (
    <div className="overflow-hidden rounded-xl border border-black/10 bg-white shadow-2xl shadow-[#06342c33]">
      <div className="flex items-center gap-1.5 border-b border-black/5 bg-[#f6faf8] px-4 py-2.5">
        <span className="size-2.5 rounded-full bg-[#f66]" />
        <span className="size-2.5 rounded-full bg-[#fc3]" />
        <span className="size-2.5 rounded-full bg-[#4c4]" />
        <span className="ml-3 hidden rounded-md bg-white px-3 py-0.5 text-[11px] text-[#94a19b] ring-1 ring-black/5 sm:block">
          app.orva.co
        </span>
      </div>
      <Image src={src} alt={alt} width={1440} height={900} className="w-full" />
    </div>
  )
}

export default function OrvaStartPage() {
  return (
    <main className={`${plexThai.className} min-h-svh w-full bg-white text-[#101828]`}>
      {/* ───── Navbar ───── */}
      <header
        className="sticky top-0 z-30 border-b border-white/10"
        style={{ background: 'rgba(9,45,38,0.85)', backdropFilter: 'blur(12px)' }}
      >
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-6">
          <Link href="/start" className="flex items-center gap-2.5">
            <Image src="/orva.svg" alt="Orva" width={32} height={32} />
            <span className="text-lg font-bold tracking-tight text-white">Orva</span>
          </Link>
          <nav className="hidden items-center gap-8 text-sm font-medium text-[#d5efe6cc] md:flex">
            <a href="#modules" className="transition hover:text-white">โมดูล</a>
            <a href="#screens" className="transition hover:text-white">ภาพระบบ</a>
            <a href="#architecture" className="transition hover:text-white">สถาปัตยกรรม</a>
          </nav>
          <div className="flex items-center gap-3">
            <Link
              href="/backend"
              className="hidden text-sm font-medium text-[#d5efe6cc] transition hover:text-white sm:block"
            >
              หน้าจัดการ
            </Link>
            <Link
              href="/login"
              className="rounded-lg bg-white px-4 py-2 text-sm font-semibold text-[#06342c] shadow-sm transition hover:bg-[#e9f7f1]"
            >
              เข้าสู่ระบบ
            </Link>
          </div>
        </div>
      </header>

      {/* ───── Hero (dark brand) ───── */}
      <section
        className="relative overflow-hidden text-white"
        style={{ background: `linear-gradient(160deg, ${BRAND.deep} 0%, ${BRAND.dark} 55%, ${BRAND.base} 130%)` }}
      >
        {/* decorative ring echoing the logomark */}
        <div
          aria-hidden
          className="pointer-events-none absolute -right-40 -top-40 size-[560px] rounded-full border-[54px] border-white/5"
        />
        <div
          aria-hidden
          className="pointer-events-none absolute -left-52 bottom-0 size-[420px] rounded-full border-[44px] border-white/[0.04]"
        />
        <div className="relative mx-auto flex max-w-6xl flex-col items-center px-6 pb-0 pt-20 text-center">
          <span className="rounded-full border border-[#7ee0c440] bg-[#7ee0c41a] px-4 py-1.5 text-xs font-medium text-[#d5efe6]">
            Orva ERP · โดย Anthovai
          </span>
          <h1 className="mt-6 max-w-3xl text-4xl font-bold leading-[1.15] tracking-tight sm:text-[3.4rem]">
            ERP ครบวงจรสำหรับธุรกิจไทย
          </h1>
          <p className="mt-3 max-w-2xl text-lg font-medium" style={{ color: BRAND.mint }}>
            ความถูกต้องทางบัญชี ถูกบังคับถึงระดับฐานข้อมูล
          </p>
          <p className="mt-5 max-w-2xl text-base leading-7 text-[#eafaf4bf]">
            การเงินและบัญชี งานขาย คลังสินค้า และเงินเดือน เชื่อมถึงกันในระบบเดียว
            ทุกเอกสารไหลเข้าบัญชีแยกประเภทอัตโนมัติ ปิดงวดได้จริง ตรวจสอบย้อนหลังได้ทุกรายการ
          </p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <Link
              href="/login"
              className="group inline-flex items-center gap-2 rounded-lg bg-white px-7 py-3 text-sm font-semibold text-[#06342c] shadow-lg transition hover:bg-[#e9f7f1]"
            >
              เริ่มใช้งาน
              <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
            </Link>
            <a
              href="#screens"
              className="rounded-lg border border-white/25 px-7 py-3 text-sm font-semibold text-white transition hover:bg-white/10"
            >
              ดูภาพระบบ
            </a>
          </div>
          <ul className="mt-8 flex flex-wrap justify-center gap-x-7 gap-y-2 text-[13px] text-[#eafaf4b3]">
            {TRUST_POINTS.map((point) => (
              <li key={point} className="flex items-center gap-1.5">
                <Check className="size-3.5" style={{ color: BRAND.mint }} />
                {point}
              </li>
            ))}
          </ul>

          {/* mock peeking out of the hero */}
          <div className="relative z-10 mt-14 w-full max-w-4xl translate-y-16 sm:translate-y-20">
            <BrowserFrame src="/marketing/screen-finance.png" alt="หน้างบการเงินของ Orva" />
          </div>
        </div>
      </section>

      {/* spacer for the overlapping mock */}
      <div className="h-24 sm:h-28" />

      {/* ───── Stats ───── */}
      <section className="mx-auto max-w-6xl px-6">
        <div className="grid grid-cols-2 gap-y-8 rounded-2xl border border-[#e3e9e6] bg-[#f6faf8] px-6 py-10 md:grid-cols-4">
          {STATS.map((stat) => (
            <div key={stat.label} className="text-center">
              <div className="text-[2rem] font-bold tabular-nums" style={{ color: BRAND.base }}>
                {stat.value}
              </div>
              <div className="mt-1 text-[13px] leading-5 text-[#66756e]">{stat.label}</div>
            </div>
          ))}
        </div>
      </section>

      {/* ───── Modules ───── */}
      <section id="modules" className="mx-auto max-w-6xl scroll-mt-24 px-6 pt-24">
        <div className="text-center">
          <div className="text-xs font-semibold uppercase tracking-[0.18em]" style={{ color: BRAND.base }}>
            โมดูล
          </div>
          <h2 className="mt-2 text-3xl font-bold tracking-tight">ครบทุกงานหลักขององค์กร</h2>
          <p className="mx-auto mt-3 max-w-xl text-[15px] text-[#66756e]">
            การเงินคือแกนกลาง — ทุกโมดูลส่งข้อมูลเข้าบัญชีแยกประเภทเดียวกัน
          </p>
        </div>

        {/* Finance core */}
        <div
          className="mt-10 rounded-2xl p-8 text-white"
          style={{ background: `linear-gradient(150deg, ${BRAND.dark}, ${BRAND.deep})` }}
        >
          <div className="flex flex-wrap items-center gap-3">
            <span className="flex size-10 items-center justify-center rounded-xl bg-white/10">
              <Landmark className="size-5" style={{ color: BRAND.mint }} />
            </span>
            <h3 className="text-xl font-semibold">การเงินและบัญชี</h3>
            <span
              className="rounded-full px-3 py-1 text-xs font-semibold"
              style={{ background: 'rgba(126,224,196,0.15)', color: BRAND.mint }}
            >
              แกนกลางของระบบ
            </span>
          </div>
          <div className="mt-7 grid gap-x-8 gap-y-6 sm:grid-cols-2 lg:grid-cols-4">
            {FINANCE_ITEMS.map((item) => (
              <div key={item.title}>
                <item.icon className="size-5" style={{ color: BRAND.mint }} />
                <h4 className="mt-2.5 text-[15px] font-semibold">{item.title}</h4>
                <p className="mt-1.5 text-[13px] leading-5 text-[#eafaf4a6]">{item.body}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Suites */}
        <div className="mt-5 grid gap-5 md:grid-cols-3">
          {SUITES.map((suite) => (
            <div
              key={suite.title}
              className="rounded-2xl border border-[#e3e9e6] bg-white p-7 transition hover:border-[#cbd6d1] hover:shadow-lg hover:shadow-[#dfe7e3]"
            >
              <span className="flex size-10 items-center justify-center rounded-xl" style={{ background: 'rgba(17,131,110,0.09)' }}>
                <suite.icon className="size-5" style={{ color: BRAND.base }} />
              </span>
              <h3 className="mt-4 text-base font-semibold">{suite.title}</h3>
              <ul className="mt-3 flex flex-col gap-2.5 text-sm text-[#49564f]">
                {suite.items.map((item) => (
                  <li key={item} className="flex items-start gap-2.5">
                    <Check className="mt-0.5 size-4 shrink-0" style={{ color: BRAND.base }} />
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </section>

      {/* ───── Screens ───── */}
      <section id="screens" className="mx-auto max-w-6xl scroll-mt-24 px-6 pt-24">
        <div className="text-center">
          <div className="text-xs font-semibold uppercase tracking-[0.18em]" style={{ color: BRAND.base }}>
            ภาพระบบ
          </div>
          <h2 className="mt-2 text-3xl font-bold tracking-tight">เห็นตัวเลขจริง ก่อนตัดสินใจ</h2>
        </div>
        <div className="mt-10 grid items-start gap-10 lg:grid-cols-2">
          <figure className="flex flex-col gap-4">
            <BrowserFrame src="/marketing/screen-finance.png" alt="หน้างบการเงินของ Orva" />
            <figcaption className="text-sm leading-6 text-[#66756e]">
              <span className="font-semibold text-[#101828]">งบการเงิน real-time</span> — งบกำไรขาดทุนและงบแสดงฐานะการเงิน
              คำนวณสดจาก journal ที่โพสต์แล้ว สมการบัญชีลงตัวเสมอ
            </figcaption>
          </figure>
          <figure className="flex flex-col gap-4">
            <BrowserFrame src="/marketing/screen-payroll.png" alt="หน้าเงินเดือนของ Orva" />
            <figcaption className="text-sm leading-6 text-[#66756e]">
              <span className="font-semibold text-[#101828]">เงินเดือนโปร่งใสรายคน</span> — คำนวณด้วย Rust engine
              (ประกันสังคม + ภาษีหัก ณ ที่จ่าย) แล้วโพสต์เข้าบัญชีเป็น journal ที่ดุลเสมอ
            </figcaption>
          </figure>
        </div>
      </section>

      {/* ───── Architecture ───── */}
      <section id="architecture" className="mx-auto max-w-6xl scroll-mt-24 px-6 pt-24">
        <div className="text-center">
          <div className="text-xs font-semibold uppercase tracking-[0.18em]" style={{ color: BRAND.base }}>
            สถาปัตยกรรม
          </div>
          <h2 className="mt-2 text-3xl font-bold tracking-tight">สร้างมาเพื่อความน่าเชื่อถือระดับงานบัญชี</h2>
        </div>
        <div className="mt-10 grid gap-5 md:grid-cols-3">
          {ARCH_POINTS.map((point) => (
            <div key={point.title} className="rounded-2xl border border-[#e3e9e6] bg-[#f6faf8] p-7">
              <point.icon className="size-6" style={{ color: BRAND.base }} />
              <h3 className="mt-4 text-[15px] font-semibold">{point.title}</h3>
              <p className="mt-2 text-[13px] leading-6 text-[#66756e]">{point.body}</p>
            </div>
          ))}
        </div>
        <p className="mt-8 text-center text-xs tracking-wide text-[#94a19b]">
          PostgreSQL · Next.js / TypeScript · Rust · สร้างบน Open Mercato (MIT)
        </p>
      </section>

      {/* ───── CTA ───── */}
      <section className="mx-auto max-w-6xl px-6 pb-24 pt-24">
        <div
          className="relative overflow-hidden rounded-2xl px-8 py-16 text-center text-white"
          style={{ background: `linear-gradient(150deg, ${BRAND.deep}, ${BRAND.base})` }}
        >
          <div
            aria-hidden
            className="pointer-events-none absolute -right-24 -top-24 size-72 rounded-full border-[36px] border-white/10"
          />
          <h2 className="text-3xl font-bold tracking-tight">พร้อมเริ่มใช้ Orva แล้วหรือยัง</h2>
          <p className="mx-auto mt-3 max-w-xl text-[15px] text-[#eafaf4cc]">
            จัดการบัญชี งานขาย คลังสินค้า และเงินเดือนของคุณจากที่เดียว — เป็นภาษาไทยทั้งระบบ
          </p>
          <Link
            href="/login"
            className="group mt-8 inline-flex items-center gap-2 rounded-lg bg-white px-8 py-3 text-sm font-semibold text-[#06342c] shadow-lg transition hover:bg-[#e9f7f1]"
          >
            เข้าสู่ระบบ
            <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
          </Link>
        </div>
      </section>

      {/* ───── Footer ───── */}
      <footer className="text-[#eafaf4b3]" style={{ background: BRAND.deep }}>
        <div className="mx-auto grid max-w-6xl gap-10 px-6 py-14 text-sm sm:grid-cols-2 md:grid-cols-4">
          <div>
            <div className="flex items-center gap-2.5">
              <Image src="/orva.svg" alt="Orva" width={30} height={30} />
              <span className="text-base font-bold text-white">Orva</span>
            </div>
            <p className="mt-3 text-[13px] leading-6 text-[#eafaf48c]">
              ระบบ ERP ครบวงจรสำหรับธุรกิจไทย
              ที่ความถูกต้องทางบัญชีถูกบังคับถึงระดับฐานข้อมูล
            </p>
          </div>
          <div>
            <div className="text-xs font-semibold uppercase tracking-[0.15em] text-[#eafaf466]">ผลิตภัณฑ์</div>
            <ul className="mt-4 flex flex-col gap-2.5">
              <li><a href="#modules" className="transition hover:text-white">โมดูลทั้งหมด</a></li>
              <li><a href="#screens" className="transition hover:text-white">ภาพระบบ</a></li>
              <li><a href="#architecture" className="transition hover:text-white">สถาปัตยกรรม</a></li>
            </ul>
          </div>
          <div>
            <div className="text-xs font-semibold uppercase tracking-[0.15em] text-[#eafaf466]">เริ่มใช้งาน</div>
            <ul className="mt-4 flex flex-col gap-2.5">
              <li><Link href="/login" className="transition hover:text-white">เข้าสู่ระบบ</Link></li>
              <li><Link href="/backend" className="transition hover:text-white">หน้าจัดการ</Link></li>
              <li><a href="/api/docs/openapi" className="transition hover:text-white">API (OpenAPI)</a></li>
            </ul>
          </div>
          <div>
            <div className="text-xs font-semibold uppercase tracking-[0.15em] text-[#eafaf466]">บริษัท</div>
            <ul className="mt-4 flex flex-col gap-2.5">
              <li>Anthovai</li>
              <li>
                <a href="https://github.com/anthovai/orva-erp" className="transition hover:text-white">GitHub</a>
              </li>
            </ul>
          </div>
        </div>
        <div className="border-t border-white/10 py-5 text-center text-xs text-[#eafaf466]">
          © 2026 Anthovai · Orva ERP · สร้างบน Open Mercato (MIT)
        </div>
      </footer>
    </main>
  )
}
