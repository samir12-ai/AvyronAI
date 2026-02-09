import { I18n } from 'i18n-js';
import en from './translations/en';
import es from './translations/es';
import fr from './translations/fr';
import de from './translations/de';
import pt from './translations/pt';
import it from './translations/it';
import nl from './translations/nl';
import ru from './translations/ru';
import ja from './translations/ja';
import ko from './translations/ko';
import zh from './translations/zh';
import ar from './translations/ar';
import hi from './translations/hi';
import tr from './translations/tr';
import pl from './translations/pl';
import sv from './translations/sv';
import id from './translations/id';
import th from './translations/th';
import vi from './translations/vi';
import ms from './translations/ms';
import uk from './translations/uk';
import ro from './translations/ro';
import el from './translations/el';
import cs from './translations/cs';
import da from './translations/da';
import fi from './translations/fi';
import no from './translations/no';
import hu from './translations/hu';
import he from './translations/he';
import bn from './translations/bn';
import fil from './translations/fil';
import sw from './translations/sw';

const i18n = new I18n({
  en, es, fr, de, pt, it, nl, ru, ja, ko,
  zh, ar, hi, tr, pl, sv, id, th, vi, ms,
  uk, ro, el, cs, da, fi, no, hu, he, bn,
  fil, sw,
});

i18n.defaultLocale = 'en';
i18n.locale = 'en';
i18n.enableFallback = true;

export const SUPPORTED_LANGUAGES = [
  { code: 'en', name: 'English', nativeName: 'English', flag: 'GB' },
  { code: 'es', name: 'Spanish', nativeName: 'Espanol', flag: 'ES' },
  { code: 'fr', name: 'French', nativeName: 'Francais', flag: 'FR' },
  { code: 'de', name: 'German', nativeName: 'Deutsch', flag: 'DE' },
  { code: 'pt', name: 'Portuguese', nativeName: 'Portugues', flag: 'BR' },
  { code: 'it', name: 'Italian', nativeName: 'Italiano', flag: 'IT' },
  { code: 'nl', name: 'Dutch', nativeName: 'Nederlands', flag: 'NL' },
  { code: 'ru', name: 'Russian', nativeName: 'Russkij', flag: 'RU' },
  { code: 'ja', name: 'Japanese', nativeName: 'Nihongo', flag: 'JP' },
  { code: 'ko', name: 'Korean', nativeName: 'Hangugeo', flag: 'KR' },
  { code: 'zh', name: 'Chinese', nativeName: 'Zhongwen', flag: 'CN' },
  { code: 'ar', name: 'Arabic', nativeName: 'Al-Arabiyyah', flag: 'SA' },
  { code: 'hi', name: 'Hindi', nativeName: 'Hindi', flag: 'IN' },
  { code: 'tr', name: 'Turkish', nativeName: 'Turkce', flag: 'TR' },
  { code: 'pl', name: 'Polish', nativeName: 'Polski', flag: 'PL' },
  { code: 'sv', name: 'Swedish', nativeName: 'Svenska', flag: 'SE' },
  { code: 'id', name: 'Indonesian', nativeName: 'Bahasa Indonesia', flag: 'ID' },
  { code: 'th', name: 'Thai', nativeName: 'Phasa Thai', flag: 'TH' },
  { code: 'vi', name: 'Vietnamese', nativeName: 'Tieng Viet', flag: 'VN' },
  { code: 'ms', name: 'Malay', nativeName: 'Bahasa Melayu', flag: 'MY' },
  { code: 'uk', name: 'Ukrainian', nativeName: 'Ukrainska', flag: 'UA' },
  { code: 'ro', name: 'Romanian', nativeName: 'Romana', flag: 'RO' },
  { code: 'el', name: 'Greek', nativeName: 'Ellinika', flag: 'GR' },
  { code: 'cs', name: 'Czech', nativeName: 'Cestina', flag: 'CZ' },
  { code: 'da', name: 'Danish', nativeName: 'Dansk', flag: 'DK' },
  { code: 'fi', name: 'Finnish', nativeName: 'Suomi', flag: 'FI' },
  { code: 'no', name: 'Norwegian', nativeName: 'Norsk', flag: 'NO' },
  { code: 'hu', name: 'Hungarian', nativeName: 'Magyar', flag: 'HU' },
  { code: 'he', name: 'Hebrew', nativeName: 'Ivrit', flag: 'IL' },
  { code: 'bn', name: 'Bengali', nativeName: 'Bangla', flag: 'BD' },
  { code: 'fil', name: 'Filipino', nativeName: 'Filipino', flag: 'PH' },
  { code: 'sw', name: 'Swahili', nativeName: 'Kiswahili', flag: 'KE' },
] as const;

export type LanguageCode = typeof SUPPORTED_LANGUAGES[number]['code'];

export default i18n;
