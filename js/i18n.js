(function () {
  const LANGUAGE_KEY = 'fitmetric-language';
  const supportedLanguages = ['id', 'en'];
  let currentLanguage = 'id';

  function getLanguage() {
    return currentLanguage;
  }

  function t(key) {
    const translations = window.FITMETRIC_TRANSLATIONS || {};
    return (translations[currentLanguage] && translations[currentLanguage][key]) || key;
  }

  function getLocale() {
    return currentLanguage === 'id' ? 'id-ID' : 'en-US';
  }

  function formatNumber(value, options) {
    return new Intl.NumberFormat(getLocale(), options).format(value);
  }

  function formatDate(value, options) {
    return new Intl.DateTimeFormat(getLocale(), options || { month: 'short', day: 'numeric' }).format(new Date(value));
  }

  function updateSwitcherLabels() {
    document.querySelectorAll('[data-language-label]').forEach((label) => {
      label.textContent = currentLanguage === 'id' ? 'Bahasa: Indonesia' : 'Language: English';
    });

    document.querySelectorAll('[data-language-option]').forEach((option) => {
      option.classList.toggle('active', option.dataset.languageOption === currentLanguage);
      option.setAttribute('aria-pressed', String(option.dataset.languageOption === currentLanguage));
    });

    document.querySelectorAll('[data-language-select]').forEach((select) => {
      select.value = currentLanguage;
    });
  }

  function applyTranslations() {
    document.documentElement.lang = currentLanguage;

    document.querySelectorAll('[data-i18n]').forEach((element) => {
      const key = element.dataset.i18n;
      const translation = t(key);
      const textNode = Array.from(element.childNodes).find((node) => node.nodeType === Node.TEXT_NODE && node.textContent.trim());

      if (textNode) {
        const leadingSpace = /^\s/.test(textNode.textContent) ? ' ' : '';
        const trailingSpace = /\s$/.test(textNode.textContent) ? ' ' : '';
        textNode.textContent = `${leadingSpace}${translation}${trailingSpace}`;
      } else {
        element.textContent = translation;
      }
    });

    document.querySelectorAll('[data-i18n-placeholder]').forEach((element) => {
      element.setAttribute('placeholder', t(element.dataset.i18nPlaceholder));
    });

    document.querySelectorAll('[data-i18n-aria-label]').forEach((element) => {
      element.setAttribute('aria-label', t(element.dataset.i18nAriaLabel));
    });

    document.querySelectorAll('[data-i18n-title]').forEach((element) => {
      element.setAttribute('title', t(element.dataset.i18nTitle));
    });

    document.querySelectorAll('[data-i18n-alt]').forEach((element) => {
      element.setAttribute('alt', t(element.dataset.i18nAlt));
    });

    document.querySelectorAll('[data-i18n-content]').forEach((element) => {
      element.setAttribute('content', t(element.dataset.i18nContent));
    });

    updateSwitcherLabels();
    window.dispatchEvent(new CustomEvent('fitmetric:languageChanged', { detail: { language: currentLanguage } }));
  }

  function setLanguage(language) {
    if (!supportedLanguages.includes(language)) return;
    currentLanguage = language;

    try {
      localStorage.setItem(LANGUAGE_KEY, language);
    } catch (error) {
      console.warn('Could not save language preference:', error);
    }

    applyTranslations();
  }

  function initializeLanguage() {
    try {
      const savedLanguage = localStorage.getItem(LANGUAGE_KEY);
      currentLanguage = supportedLanguages.includes(savedLanguage) ? savedLanguage : 'id';
    } catch (error) {
      console.warn('Could not load language preference:', error);
      currentLanguage = 'id';
    }

    applyTranslations();
  }

  document.addEventListener('click', (event) => {
    const option = event.target.closest('[data-language-option]');
    if (option) {
      setLanguage(option.dataset.languageOption);
      const menu = option.closest('.language-switcher');
      if (menu) {
        menu.classList.remove('open');
        const button = menu.querySelector('.language-trigger');
        if (button) button.setAttribute('aria-expanded', 'false');
      }
      return;
    }

    const trigger = event.target.closest('.language-trigger');
    if (trigger) {
      const switcher = trigger.closest('.language-switcher');
      const isOpen = switcher.classList.toggle('open');
      trigger.setAttribute('aria-expanded', String(isOpen));
      return;
    }

    document.querySelectorAll('.language-switcher.open').forEach((switcher) => {
      switcher.classList.remove('open');
      const button = switcher.querySelector('.language-trigger');
      if (button) button.setAttribute('aria-expanded', 'false');
    });
  });

  document.addEventListener('change', (event) => {
    const select = event.target.closest('[data-language-select]');
    if (select) setLanguage(select.value);
  });

  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;

    document.querySelectorAll('.language-switcher.open').forEach((switcher) => {
      switcher.classList.remove('open');
      const button = switcher.querySelector('.language-trigger');
      if (button) {
        button.setAttribute('aria-expanded', 'false');
        button.focus();
      }
    });
  });

  window.fitmetricI18n = {
    getLanguage,
    getLocale,
    t,
    formatDate,
    formatNumber,
    setLanguage,
    applyTranslations
  };

  document.addEventListener('DOMContentLoaded', initializeLanguage);
})();
