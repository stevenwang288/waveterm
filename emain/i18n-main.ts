import i18next from "i18next";

import enTranslation from "../frontend/locales/en/translation.json";
import zhCNTranslation from "../frontend/locales/zh-CN/translation.json";

i18next.init({
    lng: "zh-CN",
    fallbackLng: "en",
    resources: {
        en: { translation: enTranslation },
        "zh-CN": { translation: zhCNTranslation },
    },
});

export default i18next;
