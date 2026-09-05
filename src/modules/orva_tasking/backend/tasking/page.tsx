import { redirect } from 'next/navigation'

/**
 * The task app is a separate process (KKG-Tasking, the company's Vikunja fork)
 * served from this same origin at /tasks by a rewrite in next.config.ts. It
 * brings its own full-page shell, so it is not embedded inside Orva's chrome —
 * nesting two navigations would give the user two sidebars and two logos.
 *
 * This route exists so the app earns a real entry in Orva's sidebar: nav items
 * are built from backend routes and carry no external-href option, so the menu
 * link needs a page to point at. Its only job is to hand over.
 */
export default function TasksPage() {
  redirect('/tasks')
}
