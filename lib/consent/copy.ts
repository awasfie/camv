/**
 * WC-CV-3 step 1 — join-banner purpose text per org country, EN/AR.
 *
 * Copy rules: UX.2.1 (plain, no exclamation marks, never blame the user), UX.2.3
 * (MSA, singular أنت, Arabic punctuation), UX.2.2 (Camv: friendly and simple).
 * UX.2.3: the Arabic strings are reviewed by Ahmed or a native reviewer he names
 * before launch; until then they are the draft prepared for counsel under R3-30
 * (docs/legal/camv-consent-texts.md carries the same strings).
 *
 * Bump CONSENT_TEXT_VERSION whenever any string below changes: every consent_events
 * row stores the version it was given against.
 */
import type { ConsentLocale } from './policy';
import { normaliseCountry } from './policy';

export const CONSENT_TEXT_VERSION = 'cv3-2026-10-13';

export type ConsentJurisdiction = 'SA' | 'AE' | 'EG' | 'DEFAULT';

export type ConsentCopy = {
  title: string;
  body: string;
  /** Country-specific legal basis line shown under the body. */
  basis: string;
  agree: string;
  decline: string;
  declinedNote: string;
  recordingLive: string;
  switchLanguage: string;
};

const COMMON_EN = {
  title: 'This meeting may be recorded',
  agree: 'I agree',
  decline: 'Join without being recorded',
  declinedNote:
    'You chose not to be recorded. If a recording is running, your camera and microphone stay off until it stops.',
  recordingLive: 'REC',
  switchLanguage: 'العربية',
};

const COMMON_AR = {
  title: 'قد يُسجَّل هذا الاجتماع',
  agree: 'أوافق',
  decline: 'الانضمام دون تسجيل',
  declinedNote:
    'اخترت عدم التسجيل. إذا كان التسجيل قيد التشغيل، تبقى الكاميرا والميكروفون متوقفَين حتى يتوقف التسجيل.',
  recordingLive: 'تسجيل',
  switchLanguage: 'English',
};

const BODY_EN =
  'The host can record this meeting and create a transcript and summary from it. ' +
  'Recording starts only after everyone in the meeting agrees, and you will see a REC sign while it runs. ' +
  'The recording is stored privately for the period set by the host’s workspace plan and is then deleted.';

const BODY_AR =
  'يمكن للمضيف تسجيل هذا الاجتماع وإنشاء نص مكتوب وملخص منه. ' +
  'لا يبدأ التسجيل إلا بعد موافقة جميع المشاركين، وستظهر علامة «تسجيل» طوال مدة التسجيل. ' +
  'يُحفَظ التسجيل بشكل خاص للمدة التي تحددها باقة مساحة عمل المضيف، ثم يُحذف.';

// Data location (docs/legal/camv-data-flows.md): media server and recording storage
// are in Europe; transcription and summary vendors may process outside the region.
const BASIS: Record<ConsentJurisdiction, Record<ConsentLocale, string>> = {
  SA: {
    en: 'Under the Saudi Personal Data Protection Law, your agreement is the basis for recording. The recording is stored outside the Kingdom, in Europe, and our service providers may process it to create the transcript and summary.',
    ar: 'وفقاً لنظام حماية البيانات الشخصية في المملكة العربية السعودية، تُعدّ موافقتك أساس التسجيل. يُحفَظ التسجيل خارج المملكة، في أوروبا، وقد يعالجه مزوّدو الخدمة لدينا لإنشاء النص المكتوب والملخص.',
  },
  AE: {
    en: 'UAE law requires the agreement of everyone in a conversation before it is recorded. The recording is stored outside the UAE, in Europe, and our service providers may process it to create the transcript and summary.',
    ar: 'يشترط القانون في دولة الإمارات موافقة جميع أطراف المحادثة قبل تسجيلها. يُحفَظ التسجيل خارج الدولة، في أوروبا، وقد يعالجه مزوّدو الخدمة لدينا لإنشاء النص المكتوب والملخص.',
  },
  EG: {
    en: 'Under Egypt’s Personal Data Protection Law, your explicit agreement is the basis for recording. The recording is stored outside Egypt, in Europe, and our service providers may process it to create the transcript and summary.',
    ar: 'وفقاً لقانون حماية البيانات الشخصية في مصر، تُعدّ موافقتك الصريحة أساس التسجيل. يُحفَظ التسجيل خارج مصر، في أوروبا، وقد يعالجه مزوّدو الخدمة لدينا لإنشاء النص المكتوب والملخص.',
  },
  DEFAULT: {
    en: 'Your agreement is the basis for recording. The recording is stored in Europe, and our service providers may process it to create the transcript and summary.',
    ar: 'تُعدّ موافقتك أساس التسجيل. يُحفَظ التسجيل في أوروبا، وقد يعالجه مزوّدو الخدمة لدينا لإنشاء النص المكتوب والملخص.',
  },
};

export function jurisdictionFor(country: string | null | undefined): ConsentJurisdiction {
  const c = normaliseCountry(country);
  return c === 'SA' || c === 'AE' || c === 'EG' ? c : 'DEFAULT';
}

export function consentCopy(
  country: string | null | undefined,
  locale: ConsentLocale,
): ConsentCopy {
  const j = jurisdictionFor(country);
  const common = locale === 'ar' ? COMMON_AR : COMMON_EN;
  return {
    ...common,
    body: locale === 'ar' ? BODY_AR : BODY_EN,
    basis: BASIS[j][locale],
  };
}

/** Both locales, so the client can switch language without another request. */
export function consentCopyBundle(country: string | null | undefined) {
  return {
    version: CONSENT_TEXT_VERSION,
    jurisdiction: jurisdictionFor(country),
    en: consentCopy(country, 'en'),
    ar: consentCopy(country, 'ar'),
  };
}
