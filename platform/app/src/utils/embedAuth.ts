/**
 * Sign-in inside the report window's frame (Rev 11 milestone 6 part 2,
 * `pacsai.embed/1` §3).
 *
 * The identity provider's login page refuses to be framed, so a viewer framed
 * by the report window must never navigate itself there. Without a user it
 * records AUTH_REQUIRED and tells the shell, which offers the sign-in in a
 * top-level window. Not framed, the sign-in redirect runs as before.
 *
 * The decision is pure, and the notice takes its document, so both are
 * testable without a browser.
 */

export type UnauthenticatedAction = 'redirect' | 'report-auth-required';

/** What a document without a user does: go to the sign-in page, or tell the shell. */
export function unauthenticatedAction({ framed }: { framed: boolean }): UnauthenticatedAction {
  return framed ? 'report-auth-required' : 'redirect';
}

export const AUTH_REQUIRED_NOTICE_TEXT = 'Sign-in needed — sign in from the report window.';
export const AUTH_REQUIRED_NOTICE_LINK = 'Open the viewer in its own window';

const NOTICE_ATTRIBUTE = 'data-pacsai-auth-required';

/**
 * The static notice of a framed document that did not boot (no React: the app
 * never mounted). Written into the element OHIF mounts into, else the body;
 * the link opens `href` (this viewer address) in its own window, where the
 * sign-in is not framed. Styled inline on its own dark ground, since no app
 * stylesheet is guaranteed. Idempotent: a second call returns the first notice.
 */
export function writeAuthRequiredNotice(doc: Document, href: string): HTMLElement | null {
  const host = doc.getElementById('root') ?? doc.body;
  if (!host) {
    return null;
  }
  const existing = host.querySelector<HTMLElement>(`[${NOTICE_ATTRIBUTE}]`);
  if (existing) {
    return existing;
  }

  const notice = doc.createElement('div');
  notice.setAttribute(NOTICE_ATTRIBUTE, '');
  notice.setAttribute('role', 'status');
  notice.style.cssText = [
    'box-sizing:border-box',
    'min-height:100vh',
    'margin:0',
    'padding:24px',
    'display:flex',
    'flex-direction:column',
    'align-items:center',
    'justify-content:center',
    'gap:12px',
    'background:#050B14',
    'color:#E6EDF3',
    'font:14px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif',
    'text-align:center',
  ].join(';');

  const text = doc.createElement('p');
  text.style.cssText = 'margin:0';
  text.textContent = AUTH_REQUIRED_NOTICE_TEXT;

  const link = doc.createElement('a');
  link.href = href;
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  link.style.cssText = 'color:#7CC4FF;text-decoration:underline';
  link.textContent = AUTH_REQUIRED_NOTICE_LINK;

  notice.appendChild(text);
  notice.appendChild(link);
  host.appendChild(notice);
  return notice;
}
