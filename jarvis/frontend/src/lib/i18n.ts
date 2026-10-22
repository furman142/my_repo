import type { HudState } from "../app/stateMachine";

export type Lang = "en" | "he";

const en = {
  states: {
    BOOTING: "Initialising", IDLE: "Standing by", LISTENING: "Listening", TRANSCRIBING: "Transcribing",
    THINKING: "Thinking", APPROVAL_REQUIRED: "Awaiting approval", EXECUTING: "Executing", SPEAKING: "Speaking",
    OFFLINE: "Offline", ERROR: "Error",
  } satisfies Record<HudState, string>,
  mic: "Push to talk", micHold: "Hold to talk · tap to toggle", stop: "Stop", mute: "Mute voice", unmute: "Unmute voice",
  keyboard: "Type a message", send: "Send", placeholder: "Speak to JARVIS…", transcript: "Transcript",
  tasks: "Tasks", memories: "Memories", settings: "Settings", diagnostics: "Diagnostics", close: "Close",
  approve: "Approve", deny: "Deny", approvalTitle: "Approval required", expiresIn: "Expires in",
  approvalNote: "JARVIS asked to perform this action. Nothing happens unless you approve.",
  login: "Sign in", setup: "Create owner account", username: "Username", password: "Password",
  confirmPassword: "Confirm password", setupCode: "Setup code (printed in the server console)",
  setupHint: "First run: choose your credentials. The setup code is shown in the JARVIS server window and in data/setup-code.txt.",
  logout: "Sign out", retry: "Retry", reconnecting: "Connection lost — reconnecting…",
  voiceNotConfigured: "Voice not configured", micDenied: "Microphone permission denied",
  noMic: "Microphone not supported in this browser (HTTPS required on iPhone)",
  online: "Link", llm: "LLM", stt: "STT", voice: "Voice", openLink: "Open link", replay: "Replay",
  addTask: "Add task", due: "Due (YYYY-MM-DD or YYYY-MM-DDTHH:MM)", noTasks: "No tasks yet.",
  addMemory: "Remember", search: "Search", noMemories: "No memories stored.", proposed: "Proposed",
  confirm: "Confirm", reject: "Reject", edit: "Edit", save: "Save", del: "Delete", eraseAll: "Erase all",
  reviewTranscript: "Review transcript before sending", skip: "Skip",
  cloudNotice: "Voice replies are synthesised by Fish Audio (cloud): the spoken reply text is sent to Fish Audio. "
    + "Microphone audio is transcribed locally and never leaves this PC.",
};

type Dict = typeof en;

const he: Dict = {
  states: {
    BOOTING: "מאתחל", IDLE: "בהמתנה", LISTENING: "מקשיב", TRANSCRIBING: "מתמלל", THINKING: "חושב",
    APPROVAL_REQUIRED: "ממתין לאישור", EXECUTING: "מבצע", SPEAKING: "מדבר", OFFLINE: "לא מחובר", ERROR: "שגיאה",
  },
  mic: "לחץ כדי לדבר", micHold: "החזק כדי לדבר · הקש להפעלה/עצירה", stop: "עצור", mute: "השתק קול",
  unmute: "בטל השתקה", keyboard: "הקלד הודעה", send: "שלח", placeholder: "דבר עם JARVIS…", transcript: "תמליל",
  tasks: "משימות", memories: "זיכרונות", settings: "הגדרות", diagnostics: "אבחון", close: "סגור",
  approve: "אשר", deny: "דחה", approvalTitle: "נדרש אישור", expiresIn: "פג בעוד",
  approvalNote: "JARVIS ביקש לבצע פעולה זו. שום דבר לא יקרה בלי אישורך.",
  login: "כניסה", setup: "יצירת חשבון בעלים", username: "שם משתמש", password: "סיסמה",
  confirmPassword: "אימות סיסמה", setupCode: "קוד התקנה (מוצג בחלון השרת)",
  setupHint: "הפעלה ראשונה: בחר פרטי כניסה. קוד ההתקנה מוצג בחלון שרת JARVIS ובקובץ data/setup-code.txt.",
  logout: "יציאה", retry: "נסה שוב", reconnecting: "החיבור אבד — מתחבר מחדש…",
  voiceNotConfigured: "הקול לא הוגדר", micDenied: "הגישה למיקרופון נדחתה",
  noMic: "הדפדפן לא תומך במיקרופון (באייפון נדרש HTTPS)",
  online: "חיבור", llm: "מודל", stt: "תמלול", voice: "קול", openLink: "פתח קישור", replay: "השמע שוב",
  addTask: "הוסף משימה", due: "תאריך יעד (YYYY-MM-DD או YYYY-MM-DDTHH:MM)", noTasks: "אין משימות עדיין.",
  addMemory: "זכור", search: "חיפוש", noMemories: "אין זיכרונות שמורים.", proposed: "מוצע",
  confirm: "אשר", reject: "דחה", edit: "ערוך", save: "שמור", del: "מחק", eraseAll: "מחק הכול",
  reviewTranscript: "הצג תמליל לעריכה לפני שליחה", skip: "דלג",
  cloudNotice: "תשובות קוליות מסונתזות ב-Fish Audio (ענן): טקסט התשובה המדוברת נשלח ל-Fish Audio. "
    + "הקלטת המיקרופון מתומללת מקומית ואינה עוזבת את המחשב.",
};

export const dictionaries: Record<Lang, Dict> = { en, he };

export function resolveLang(pref: "auto" | Lang | undefined): Lang {
  if (pref === "en" || pref === "he") return pref;
  const nav = typeof navigator !== "undefined" ? navigator.language : "en";
  return nav.toLowerCase().startsWith("he") || nav.toLowerCase().startsWith("iw") ? "he" : "en";
}

export function isHebrew(text: string): boolean {
  const heb = (text.match(/[֐-׿]/g) ?? []).length;
  return heb > Math.max(3, text.length * 0.15);
}
