# Camv consent and DPA texts (WC-CV-3 step 3)

Prepared for counsel under R3-30. Draft, not legal advice. Arabic strings need
review by Ahmed or a native reviewer he names before launch (UX.2.3).

Source of truth for the banner strings is `lib/consent/copy.ts`
(`CONSENT_TEXT_VERSION = cv3-2026-10-13`); `lib/consent/copy-doc.test.ts`
fails CI if this file and the code drift apart. Every consent row stores the
text version it was given against, so a changed text never rewrites history.

## 1. What the code enforces (independent of wording)

- Every participant of a room that can be recorded sees the banner before
  they can publish camera or microphone; their token carries no publish
  permission until they answer.
- Recording (and, from WC-CV-6, transcription) refuses to start with HTTP 409
  until every participant present has agreed; a late joiner reopens the gate
  and cannot publish while a capture runs unless they agree.
- A participant who declines stays in the meeting as a listener while a
  capture runs, and gets camera and microphone back when it stops.
- Egypt-country organisations cannot record at all while R3-30 default (b) is
  in force; no organisation setting overrides it.
- Free plan: no cloud recording, so no banner.

## 2. DPA inputs per jurisdiction

### KSA: PDPL, Implementing Regulation, Transfer Regulation

- Basis for recording: consent (banner); purpose limited to recording,
  transcript and summary for the meeting host's organisation.
- Transfer outside the Kingdom (France/EU servers, Cloudflare R2 EEUR, future
  STT/LLM vendors): SDAIA standard contractual clauses between the customer
  (controller) and AWSTREAMS DMCC (processor), with the Article 8 transfer risk
  assessment. Inputs for the assessment: `camv-data-flows.md` §2 (flows F1,
  F3-F5, F7, F8), sub-processor list §1, retention §4.
- Residency alternative: WC-CV-11 (in-Kingdom node and storage).

### UAE: Federal Decree-Law 45/2021 (PDPL); Penal Code privacy provisions

- All-party consent before recording a conversation: enforced by the gate.
- Processor terms: Article 23-style processor obligations (instructions only,
  confidentiality, security, sub-processor flow-down, deletion at end).
- Transfer: to the EU (adequate-protection jurisdiction) plus vendor countries
  once WC-CV-6/7 ship; disclosed in the banner.

### Egypt: Law 151/2020 and Executive Regulations

- Explicit consent: the banner plus the append-only consent record.
- Cross-border transfer requires a PDPC licence. Until counsel files it
  (R3-30 (a)), recording is disabled for Egypt-country organisations (b).
- The Egypt texts below are ready for when the licence lands; they are not
  shown today.

### Clauses common to all three DPAs

1. Subject matter: hosting live meetings; on the controller's instruction,
   recording, transcription and summary.
2. Categories: participant name, identity token, voice, image, meeting content,
   consent decision with timestamp and language.
3. Retention: per plan (Pro 30 days, Business up to 365) or the controller's
   30/90/365 setting; automated deletion with a deletion log exportable by the
   controller.
4. Sub-processors: `camv-data-flows.md` §1; 30 days' notice of changes.
5. Security: DTLS-SRTP media, TLS at rest-to-transit boundaries, private bucket,
   per-room host proof for recording control, admin routes behind a separate
   secret, append-only consent log.
6. Data-subject assistance: consent-export CSV per org.

## 3. Banner strings (EN/AR, per jurisdiction)

### Saudi Arabia (KSA) (jurisdiction SA)

EN:

- Title: This meeting may be recorded
- Body: The host can record this meeting and create a transcript and summary from it. Recording starts only after everyone in the meeting agrees, and you will see a REC sign while it runs. The recording is stored privately for the period set by the host’s workspace plan and is then deleted.
- Legal basis: Under the Saudi Personal Data Protection Law, your agreement is the basis for recording. The recording is stored outside the Kingdom, in Europe, and our service providers may process it to create the transcript and summary.
- Agree button: I agree
- Decline button: Join without being recorded
- After declining, while recording: You chose not to be recorded. If a recording is running, your camera and microphone stay off until it stops.
- Live indicator: REC

AR:

- Title: قد يُسجَّل هذا الاجتماع
- Body: يمكن للمضيف تسجيل هذا الاجتماع وإنشاء نص مكتوب وملخص منه. لا يبدأ التسجيل إلا بعد موافقة جميع المشاركين، وستظهر علامة «تسجيل» طوال مدة التسجيل. يُحفَظ التسجيل بشكل خاص للمدة التي تحددها باقة مساحة عمل المضيف، ثم يُحذف.
- Legal basis: وفقاً لنظام حماية البيانات الشخصية في المملكة العربية السعودية، تُعدّ موافقتك أساس التسجيل. يُحفَظ التسجيل خارج المملكة، في أوروبا، وقد يعالجه مزوّدو الخدمة لدينا لإنشاء النص المكتوب والملخص.
- Agree button: أوافق
- Decline button: الانضمام دون تسجيل
- After declining, while recording: اخترت عدم التسجيل. إذا كان التسجيل قيد التشغيل، تبقى الكاميرا والميكروفون متوقفَين حتى يتوقف التسجيل.
- Live indicator: تسجيل

### United Arab Emirates (jurisdiction AE)

EN:

- Title: This meeting may be recorded
- Body: The host can record this meeting and create a transcript and summary from it. Recording starts only after everyone in the meeting agrees, and you will see a REC sign while it runs. The recording is stored privately for the period set by the host’s workspace plan and is then deleted.
- Legal basis: UAE law requires the agreement of everyone in a conversation before it is recorded. The recording is stored outside the UAE, in Europe, and our service providers may process it to create the transcript and summary.
- Agree button: I agree
- Decline button: Join without being recorded
- After declining, while recording: You chose not to be recorded. If a recording is running, your camera and microphone stay off until it stops.
- Live indicator: REC

AR:

- Title: قد يُسجَّل هذا الاجتماع
- Body: يمكن للمضيف تسجيل هذا الاجتماع وإنشاء نص مكتوب وملخص منه. لا يبدأ التسجيل إلا بعد موافقة جميع المشاركين، وستظهر علامة «تسجيل» طوال مدة التسجيل. يُحفَظ التسجيل بشكل خاص للمدة التي تحددها باقة مساحة عمل المضيف، ثم يُحذف.
- Legal basis: يشترط القانون في دولة الإمارات موافقة جميع أطراف المحادثة قبل تسجيلها. يُحفَظ التسجيل خارج الدولة، في أوروبا، وقد يعالجه مزوّدو الخدمة لدينا لإنشاء النص المكتوب والملخص.
- Agree button: أوافق
- Decline button: الانضمام دون تسجيل
- After declining, while recording: اخترت عدم التسجيل. إذا كان التسجيل قيد التشغيل، تبقى الكاميرا والميكروفون متوقفَين حتى يتوقف التسجيل.
- Live indicator: تسجيل

### Egypt (jurisdiction EG)

EN:

- Title: This meeting may be recorded
- Body: The host can record this meeting and create a transcript and summary from it. Recording starts only after everyone in the meeting agrees, and you will see a REC sign while it runs. The recording is stored privately for the period set by the host’s workspace plan and is then deleted.
- Legal basis: Under Egypt’s Personal Data Protection Law, your explicit agreement is the basis for recording. The recording is stored outside Egypt, in Europe, and our service providers may process it to create the transcript and summary.
- Agree button: I agree
- Decline button: Join without being recorded
- After declining, while recording: You chose not to be recorded. If a recording is running, your camera and microphone stay off until it stops.
- Live indicator: REC

AR:

- Title: قد يُسجَّل هذا الاجتماع
- Body: يمكن للمضيف تسجيل هذا الاجتماع وإنشاء نص مكتوب وملخص منه. لا يبدأ التسجيل إلا بعد موافقة جميع المشاركين، وستظهر علامة «تسجيل» طوال مدة التسجيل. يُحفَظ التسجيل بشكل خاص للمدة التي تحددها باقة مساحة عمل المضيف، ثم يُحذف.
- Legal basis: وفقاً لقانون حماية البيانات الشخصية في مصر، تُعدّ موافقتك الصريحة أساس التسجيل. يُحفَظ التسجيل خارج مصر، في أوروبا، وقد يعالجه مزوّدو الخدمة لدينا لإنشاء النص المكتوب والملخص.
- Agree button: أوافق
- Decline button: الانضمام دون تسجيل
- After declining, while recording: اخترت عدم التسجيل. إذا كان التسجيل قيد التشغيل، تبقى الكاميرا والميكروفون متوقفَين حتى يتوقف التسجيل.
- Live indicator: تسجيل

### All other countries (jurisdiction DEFAULT)

EN:

- Title: This meeting may be recorded
- Body: The host can record this meeting and create a transcript and summary from it. Recording starts only after everyone in the meeting agrees, and you will see a REC sign while it runs. The recording is stored privately for the period set by the host’s workspace plan and is then deleted.
- Legal basis: Your agreement is the basis for recording. The recording is stored in Europe, and our service providers may process it to create the transcript and summary.
- Agree button: I agree
- Decline button: Join without being recorded
- After declining, while recording: You chose not to be recorded. If a recording is running, your camera and microphone stay off until it stops.
- Live indicator: REC

AR:

- Title: قد يُسجَّل هذا الاجتماع
- Body: يمكن للمضيف تسجيل هذا الاجتماع وإنشاء نص مكتوب وملخص منه. لا يبدأ التسجيل إلا بعد موافقة جميع المشاركين، وستظهر علامة «تسجيل» طوال مدة التسجيل. يُحفَظ التسجيل بشكل خاص للمدة التي تحددها باقة مساحة عمل المضيف، ثم يُحذف.
- Legal basis: تُعدّ موافقتك أساس التسجيل. يُحفَظ التسجيل في أوروبا، وقد يعالجه مزوّدو الخدمة لدينا لإنشاء النص المكتوب والملخص.
- Agree button: أوافق
- Decline button: الانضمام دون تسجيل
- After declining, while recording: اخترت عدم التسجيل. إذا كان التسجيل قيد التشغيل، تبقى الكاميرا والميكروفون متوقفَين حتى يتوقف التسجيل.
- Live indicator: تسجيل
