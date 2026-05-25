/** Detect phone numbers, emails, social handles — PRD chatbot filter */
const PHONE_PATTERN = /(?:\+?\d{1,3}[\s-]?)?(?:\(?\d{2,4}\)?[\s-]?)?\d{5,12}|\b\d{10}\b/;
const EMAIL_PATTERN = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/;
const SOCIAL_PATTERN = /(?:whatsapp|telegram|insta(?:gram)?|snapchat|facebook|fb\.com|@[a-zA-Z0-9_]{3,})/i;
const URL_PATTERN = /https?:\/\/|www\./i;

export function containsContactInfo(text) {
  if (!text || typeof text !== 'string') return false;
  const normalized = text.trim();
  return (
    PHONE_PATTERN.test(normalized) ||
    EMAIL_PATTERN.test(normalized) ||
    SOCIAL_PATTERN.test(normalized) ||
    URL_PATTERN.test(normalized)
  );
}

export const CONTACT_BLOCKED_MESSAGE =
  'Sharing phone numbers, emails, or social handles is not allowed in inquiry chat. Unlock contact or complete your stay to chat freely.';
