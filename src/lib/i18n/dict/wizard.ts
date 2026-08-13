import type { Bundle } from "../core";

/** Texte des Einrichtungsassistenten (Onboarding-Wizard). */
export const wizard: Bundle = {
  de: {
    "wiz.step.language": "Sprache",
    "wiz.step.workMode": "Arbeitsart",
    "wiz.step.region": "Region",
    "wiz.step.rate": "Stundenlohn",
    "wiz.step.supplements": "Zuschläge",
    "wiz.step.cloud": "Cloud",
    "wiz.step.firstJob": "Erster Job",

    "wiz.stepOf": "Schritt {current} von {total} · {step}",
    "wiz.title": "Einrichtungsassistent",

    "wiz.language.title": "Sprache wählen",
    "wiz.language.hint": "Du kannst die Sprache später jederzeit in den Einstellungen ändern.",

    "wiz.workMode.title": "Wie arbeitest du?",
    "wiz.workMode.hint": "Bestimmt, wie Schichten erfasst werden.",

    "wiz.region.title": "Land und Region",
    "wiz.region.hint": "Für automatische Feiertage.",
    "wiz.region.country": "Land",
    "wiz.region.state": "Bundesland",
    "wiz.region.noStateHint": "Feiertage können später manuell als Eintrag erfasst werden.",

    "wiz.rate.title": "Stundenlohn",
    "wiz.rate.hint": "Kann pro Job und pro Schicht angepasst werden.",
    "wiz.rate.label": "Standard-Stundenlohn (€)",

    "wiz.supplements.title": "Zuschläge",
    "wiz.supplements.hint": "Prozent vom Stundenlohn. Später änderbar.",

    "wiz.cloud.title": "Cloud-Backup aktivieren",
    "wiz.cloud.hint": "Deine Daten werden nach der Anmeldung automatisch gesichert und auf einem neuen Gerät wiederhergestellt.",
    "wiz.cloud.google": "Mit Google anmelden",
    "wiz.cloud.apple": "Mit Apple anmelden",
    "wiz.cloud.skipHint": "Du kannst diesen Schritt überspringen und dich später in den Einstellungen anmelden.",

    "wiz.firstJob.title": "Ersten Job anlegen",
    "wiz.firstJob.hint": "Name genügt – Details später ergänzen.",
    "wiz.firstJob.name": "Jobname",
    "wiz.firstJob.namePlaceholder": "z. B. Café Nord",
    "wiz.firstJob.employer": "Arbeitgeber (optional)",

    "wiz.toast.done": "Einrichtung abgeschlossen",
  },
  en: {
    "wiz.step.language": "Language",
    "wiz.step.workMode": "Work type",
    "wiz.step.region": "Region",
    "wiz.step.rate": "Hourly rate",
    "wiz.step.supplements": "Supplements",
    "wiz.step.cloud": "Cloud",
    "wiz.step.firstJob": "First job",

    "wiz.stepOf": "Step {current} of {total} · {step}",
    "wiz.title": "Setup assistant",

    "wiz.language.title": "Choose language",
    "wiz.language.hint": "You can change the language at any time in Settings.",

    "wiz.workMode.title": "How do you work?",
    "wiz.workMode.hint": "Determines how shifts are recorded.",

    "wiz.region.title": "Country and region",
    "wiz.region.hint": "For automatic public holidays.",
    "wiz.region.country": "Country",
    "wiz.region.state": "Region",
    "wiz.region.noStateHint": "Public holidays can be added manually later.",

    "wiz.rate.title": "Hourly rate",
    "wiz.rate.hint": "Can be adjusted per job and per shift.",
    "wiz.rate.label": "Default hourly rate (€)",

    "wiz.supplements.title": "Supplements",
    "wiz.supplements.hint": "Percentage of the hourly rate. Changeable later.",

    "wiz.cloud.title": "Enable cloud backup",
    "wiz.cloud.hint": "Your data is backed up automatically after signing in and restored on a new device.",
    "wiz.cloud.google": "Sign in with Google",
    "wiz.cloud.apple": "Sign in with Apple",
    "wiz.cloud.skipHint": "You can skip this step and sign in later in Settings.",

    "wiz.firstJob.title": "Create your first job",
    "wiz.firstJob.hint": "A name is enough – add details later.",
    "wiz.firstJob.name": "Job name",
    "wiz.firstJob.namePlaceholder": "e.g. Café Nord",
    "wiz.firstJob.employer": "Employer (optional)",

    "wiz.toast.done": "Setup complete",
  },
  ru: {
    "wiz.step.language": "Язык",
    "wiz.step.workMode": "Тип работы",
    "wiz.step.region": "Регион",
    "wiz.step.rate": "Ставка в час",
    "wiz.step.supplements": "Надбавки",
    "wiz.step.cloud": "Облако",
    "wiz.step.firstJob": "Первая работа",

    "wiz.stepOf": "Шаг {current} из {total} · {step}",
    "wiz.title": "Мастер настройки",

    "wiz.language.title": "Выберите язык",
    "wiz.language.hint": "Вы можете изменить язык в любое время в настройках.",

    "wiz.workMode.title": "Как вы работаете?",
    "wiz.workMode.hint": "Определяет, как фиксируются смены.",

    "wiz.region.title": "Страна и регион",
    "wiz.region.hint": "Для автоматического учёта праздников.",
    "wiz.region.country": "Страна",
    "wiz.region.state": "Регион",
    "wiz.region.noStateHint": "Праздники можно позже добавить вручную как запись.",

    "wiz.rate.title": "Ставка в час",
    "wiz.rate.hint": "Можно изменить для каждой работы и смены.",
    "wiz.rate.label": "Стандартная ставка в час (€)",

    "wiz.supplements.title": "Надбавки",
    "wiz.supplements.hint": "Процент от ставки. Можно изменить позже.",

    "wiz.cloud.title": "Включить облачное резервное копирование",
    "wiz.cloud.hint": "После входа ваши данные автоматически сохраняются и восстанавливаются на новом устройстве.",
    "wiz.cloud.google": "Войти через Google",
    "wiz.cloud.apple": "Войти через Apple",
    "wiz.cloud.skipHint": "Вы можете пропустить этот шаг и войти позже в настройках.",

    "wiz.firstJob.title": "Создать первую работу",
    "wiz.firstJob.hint": "Достаточно названия – детали можно добавить позже.",
    "wiz.firstJob.name": "Название работы",
    "wiz.firstJob.namePlaceholder": "напр. Café Nord",
    "wiz.firstJob.employer": "Работодатель (необязательно)",

    "wiz.toast.done": "Настройка завершена",
  },
  tr: {
    "wiz.step.language": "Dil",
    "wiz.step.workMode": "Çalışma şekli",
    "wiz.step.region": "Bölge",
    "wiz.step.rate": "Saatlik ücret",
    "wiz.step.supplements": "Ek ödemeler",
    "wiz.step.cloud": "Bulut",
    "wiz.step.firstJob": "İlk iş",

    "wiz.stepOf": "Adım {current}/{total} · {step}",
    "wiz.title": "Kurulum sihirbazı",

    "wiz.language.title": "Dil seç",
    "wiz.language.hint": "Dili istediğin zaman Ayarlar'dan değiştirebilirsin.",

    "wiz.workMode.title": "Nasıl çalışıyorsun?",
    "wiz.workMode.hint": "Vardiyaların nasıl kaydedileceğini belirler.",

    "wiz.region.title": "Ülke ve bölge",
    "wiz.region.hint": "Resmî tatillerin otomatik olması için.",
    "wiz.region.country": "Ülke",
    "wiz.region.state": "Bölge",
    "wiz.region.noStateHint": "Resmî tatiller daha sonra manuel olarak eklenebilir.",

    "wiz.rate.title": "Saatlik ücret",
    "wiz.rate.hint": "İşe ve vardiyaya göre ayarlanabilir.",
    "wiz.rate.label": "Varsayılan saatlik ücret (€)",

    "wiz.supplements.title": "Ek ödemeler",
    "wiz.supplements.hint": "Saatlik ücretin yüzdesi. Daha sonra değiştirilebilir.",

    "wiz.cloud.title": "Bulut yedeklemeyi etkinleştir",
    "wiz.cloud.hint": "Giriş yaptıktan sonra verilerin otomatik olarak yedeklenir ve yeni bir cihazda geri yüklenir.",
    "wiz.cloud.google": "Google ile giriş yap",
    "wiz.cloud.apple": "Apple ile giriş yap",
    "wiz.cloud.skipHint": "Bu adımı atlayıp daha sonra Ayarlar'dan giriş yapabilirsin.",

    "wiz.firstJob.title": "İlk işini oluştur",
    "wiz.firstJob.hint": "Bir ad yeterli – ayrıntıları sonra ekle.",
    "wiz.firstJob.name": "İş adı",
    "wiz.firstJob.namePlaceholder": "örn. Café Nord",
    "wiz.firstJob.employer": "İşveren (isteğe bağlı)",

    "wiz.toast.done": "Kurulum tamamlandı",
  },
  pl: {
    "wiz.step.language": "Język",
    "wiz.step.workMode": "Rodzaj pracy",
    "wiz.step.region": "Region",
    "wiz.step.rate": "Stawka godzinowa",
    "wiz.step.supplements": "Dodatki",
    "wiz.step.cloud": "Chmura",
    "wiz.step.firstJob": "Pierwsza praca",

    "wiz.stepOf": "Krok {current} z {total} · {step}",
    "wiz.title": "Asystent konfiguracji",

    "wiz.language.title": "Wybierz język",
    "wiz.language.hint": "Język możesz zmienić w dowolnym momencie w ustawieniach.",

    "wiz.workMode.title": "Jak pracujesz?",
    "wiz.workMode.hint": "Określa sposób rejestrowania zmian.",

    "wiz.region.title": "Kraj i region",
    "wiz.region.hint": "Dla automatycznych świąt.",
    "wiz.region.country": "Kraj",
    "wiz.region.state": "Region",
    "wiz.region.noStateHint": "Święta można później dodać ręcznie jako wpis.",

    "wiz.rate.title": "Stawka godzinowa",
    "wiz.rate.hint": "Można dostosować dla każdej pracy i zmiany.",
    "wiz.rate.label": "Domyślna stawka godzinowa (€)",

    "wiz.supplements.title": "Dodatki",
    "wiz.supplements.hint": "Procent stawki godzinowej. Można zmienić później.",

    "wiz.cloud.title": "Włącz kopię zapasową w chmurze",
    "wiz.cloud.hint": "Po zalogowaniu Twoje dane są automatycznie zapisywane i przywracane na nowym urządzeniu.",
    "wiz.cloud.google": "Zaloguj się przez Google",
    "wiz.cloud.apple": "Zaloguj się przez Apple",
    "wiz.cloud.skipHint": "Możesz pominąć ten krok i zalogować się później w ustawieniach.",

    "wiz.firstJob.title": "Utwórz pierwszą pracę",
    "wiz.firstJob.hint": "Wystarczy nazwa – szczegóły dodasz później.",
    "wiz.firstJob.name": "Nazwa pracy",
    "wiz.firstJob.namePlaceholder": "np. Café Nord",
    "wiz.firstJob.employer": "Pracodawca (opcjonalnie)",

    "wiz.toast.done": "Konfiguracja zakończona",
  },
};
