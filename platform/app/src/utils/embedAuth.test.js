import {
  unauthenticatedAction,
  writeAuthRequiredNotice,
  AUTH_REQUIRED_NOTICE_TEXT,
  AUTH_UNAVAILABLE_NOTICE_TEXT,
  AUTH_REQUIRED_NOTICE_LINK,
} from './embedAuth';

const HREF = 'https://viewer.test/viewer/viewer?StudyInstanceUIDs=1.2.3&gatewayAET=GW_1';

describe('unauthenticatedAction', () => {
  it('redirects when not framed and reports auth-required when framed', () => {
    expect(unauthenticatedAction({ framed: false })).toBe('redirect');
    expect(unauthenticatedAction({ framed: true })).toBe('report-auth-required');
  });
});

describe('writeAuthRequiredNotice', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('writes an accessible status with the text and a link to this address in its own window', () => {
    document.body.innerHTML = '<div id="react-portal"></div><div id="root"></div>';
    const notice = writeAuthRequiredNotice(document, HREF);
    const root = document.getElementById('root');

    expect(notice).not.toBeNull();
    expect(notice.parentElement).toBe(root);
    expect(notice.getAttribute('role')).toBe('status');
    expect(notice.getAttribute('data-pacsai-auth-required')).toBe('AUTH_REQUIRED');
    expect(notice.querySelector('p').textContent).toBe(AUTH_REQUIRED_NOTICE_TEXT);
    expect(AUTH_REQUIRED_NOTICE_TEXT).toBe('Sign-in needed — sign in from the report window.');

    const link = notice.querySelector('a');
    expect(link.textContent).toBe(AUTH_REQUIRED_NOTICE_LINK);
    expect(AUTH_REQUIRED_NOTICE_LINK).toBe('Open the viewer in its own window');
    expect(link.href).toBe(HREF);
    expect(link.target).toBe('_blank');
    expect(link.rel).toBe('noopener noreferrer');
    // Readable on its own dark ground, whatever stylesheet did or did not load.
    expect(notice.style.color).not.toBe('');
    expect(notice.style.background).not.toBe('');
  });

  it('says the sign-in did not answer for AUTH_UNAVAILABLE, with the same link, and carries the code', () => {
    document.body.innerHTML = '<div id="root"></div>';
    const notice = writeAuthRequiredNotice(document, HREF, 'AUTH_UNAVAILABLE');

    expect(notice.parentElement).toBe(document.getElementById('root'));
    expect(notice.getAttribute('role')).toBe('status');
    expect(document.querySelector('[data-pacsai-auth-required]')).toBe(notice);
    expect(notice.getAttribute('data-pacsai-auth-required')).toBe('AUTH_UNAVAILABLE');
    expect(notice.querySelector('p').textContent).toBe(AUTH_UNAVAILABLE_NOTICE_TEXT);
    expect(AUTH_UNAVAILABLE_NOTICE_TEXT).toBe('Sign-in did not answer — try again from the report window.');
    const link = notice.querySelector('a');
    expect(link.textContent).toBe(AUTH_REQUIRED_NOTICE_LINK);
    expect(link.href).toBe(HREF);
    expect(link.target).toBe('_blank');
    expect(link.rel).toBe('noopener noreferrer');
  });

  it('falls back to the body without the mount element, and writes the notice once', () => {
    document.body.innerHTML = '';
    const first = writeAuthRequiredNotice(document, HREF);
    const second = writeAuthRequiredNotice(document, HREF);

    expect(first.parentElement).toBe(document.body);
    expect(second).toBe(first);
    expect(document.querySelectorAll('[role="status"]')).toHaveLength(1);
  });
});
