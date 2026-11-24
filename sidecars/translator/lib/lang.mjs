/**
 * Lightweight heuristic language detector to avoid wasting API calls
 * when the model's thinking is already in the user's target language.
 */

// High-frequency Simplified-only vs Traditional-only characters for zh-TW / zh-CN disambiguation.
const SIMPLIFIED_MARKERS = /[这为发说时会对里国经动现过给让从边还进开问实种头体应该样经点图义]/g;
const TRADITIONAL_MARKERS = /[這為發說時會對裡國經動現過給讓從邊還進開問實種頭體應該樣點圖義]/g;

function stripCodeAndNoise(text) {
  return String(text ?? '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`[^`]*`/g, ' ')
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/(?:\/[\w.-]+){2,}/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function shouldSkipTranslation(text, targetLang) {
  const cleaned = stripCodeAndNoise(text);
  if (cleaned.length < 4) {
    return { skip: true, reason: 'too_short' };
  }

  const hanCount = (cleaned.match(/[\u4E00-\u9FFF]/g) || []).length;
  const kanaCount = (cleaned.match(/[\u3040-\u30FF]/g) || []).length;
  const hangulCount = (cleaned.match(/[\uAC00-\uD7AF]/g) || []).length;
  const latinCount = (cleaned.match(/[A-Za-z]/g) || []).length;
  const totalLetters = hanCount + kanaCount + hangulCount + latinCount;

  if (totalLetters < 4) {
    return { skip: true, reason: 'no_natural_text' };
  }

  const hanRatio = hanCount / totalLetters;
  const kanaRatio = kanaCount / totalLetters;
  const hangulRatio = hangulCount / totalLetters;
  const latinRatio = latinCount / totalLetters;

  if (targetLang === 'zh-TW') {
    if (hanRatio >= 0.4 && kanaRatio < 0.08 && hangulRatio < 0.08) {
      const simp = (cleaned.match(SIMPLIFIED_MARKERS) || []).length;
      const trad = (cleaned.match(TRADITIONAL_MARKERS) || []).length;
      // Already Chinese and predominantly Traditional (or neutral short Chinese)
      if (trad >= simp || simp <= 1) {
        return { skip: true, reason: 'already_target_lang' };
      }
    }
    return { skip: false };
  }

  if (targetLang === 'zh-CN') {
    if (hanRatio >= 0.4 && kanaRatio < 0.08 && hangulRatio < 0.08) {
      const simp = (cleaned.match(SIMPLIFIED_MARKERS) || []).length;
      const trad = (cleaned.match(TRADITIONAL_MARKERS) || []).length;
      if (simp >= trad || trad <= 1) {
        return { skip: true, reason: 'already_target_lang' };
      }
    }
    return { skip: false };
  }

  if (targetLang === 'en') {
    if (latinRatio >= 0.85 && hanRatio < 0.05 && kanaRatio < 0.05 && hangulRatio < 0.05) {
      return { skip: true, reason: 'already_target_lang' };
    }
    return { skip: false };
  }

  if (targetLang === 'ja') {
    if (kanaRatio >= 0.12 && hangulRatio < 0.05) {
      return { skip: true, reason: 'already_target_lang' };
    }
    return { skip: false };
  }

  if (targetLang === 'ko') {
    if (hangulRatio >= 0.3) {
      return { skip: true, reason: 'already_target_lang' };
    }
    return { skip: false };
  }

  return { skip: false };
}
