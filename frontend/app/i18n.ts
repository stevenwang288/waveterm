import i18n from "i18next";
import { initReactI18next } from "react-i18next";

import enTranslation from "../../public/locales/en/translation.json";
import zhCNTranslation from "../../public/locales/zh-CN/translation.json";

i18n.use(initReactI18next).init({
    lng: "zh-CN",
    fallbackLng: "en",
    debug: false,
    interpolation: {
        escapeValue: false,
    },
    resources: {
        en: { translation: enTranslation },
        "zh-CN": { translation: zhCNTranslation },
    },
});

export default i18n;
