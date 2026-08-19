import i18next from "i18next";

import enTranslation from "../locales/en/translation.json";
import zhCNTranslation from "../locales/zh-CN/translation.json";

i18next.init({
    lng: "zh-CN",
    fallbackLng: "en",
    resources: {
        en: { translation: enTranslation },
        "zh-CN": { translation: zhCNTranslation },
    },
});

export default i18next;