(() => {
  const textTargets = {
    heroTitle: '[data-cms-key="heroTitle"]',
    heroDescription: '[data-cms-key="heroDescription"]',
    heroButton: '[data-cms-key="heroButton"]',
    heroSecondaryButton: '[data-cms-key="heroSecondaryButton"]',
    navHome: '[data-cms-key="navHome"]',
    navFeatures: '[data-cms-key="navFeatures"]',
    navPrograms: '[data-cms-key="navPrograms"]',
    navTrainers: '[data-cms-key="navTrainers"]',
    navAbout: '[data-cms-key="navAbout"]',
    navLogin: '[data-cms-key="navLogin"]',
    navRegister: '[data-cms-key="navRegister"]',
    featuresEyebrow: '[data-cms-key="featuresEyebrow"]',
    featuresTitle: '[data-cms-key="featuresTitle"]',
    featuresDescription: '[data-cms-key="featuresDescription"]',
    programsEyebrow: '[data-cms-key="programsEyebrow"]',
    programsTitle: '[data-cms-key="programsTitle"]',
    trainersEyebrow: '[data-cms-key="trainersEyebrow"]',
    trainersTitle: '[data-cms-key="trainersTitle"]',
    aboutEyebrow: '[data-cms-key="aboutEyebrow"]',
    aboutTitle: '[data-cms-key="aboutTitle"]',
    aboutDescription: '[data-cms-key="aboutDescription"]',
    aboutBullet1: '[data-cms-key="aboutBullet1"]',
    aboutBullet2: '[data-cms-key="aboutBullet2"]',
    aboutBullet3: '[data-cms-key="aboutBullet3"]',
    statMembers: '[data-cms-key="statMembers"]',
    statProgress: '[data-cms-key="statProgress"]',
    statRating: '[data-cms-key="statRating"]',
    footerTagline: '[data-cms-key="footerTagline"]',
    footerHome: '[data-cms-key="footerHome"]',
    footerFeatures: '[data-cms-key="footerFeatures"]',
    footerPrograms: '[data-cms-key="footerPrograms"]',
    footerTrainers: '[data-cms-key="footerTrainers"]',
    footerLogin: '[data-cms-key="footerLogin"]'
  };
  const themeVariables = {
    background: '--bg',
    card: '--card',
    text: '--text',
    muted: '--muted',
    primary: '--cms-primary-button',
    secondary: '--cms-secondary-button',
    navBackground: '--cms-nav-background',
    accent: '--accent',
    border: '--line'
  };
  let publishedContentSignature = '';

  function node(tag, className, value) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (value !== undefined) element.textContent = value;
    return element;
  }

  function removeTranslations(element) {
    element.removeAttribute('data-i18n');
    element.removeAttribute('data-i18n-alt');
  }

  function renderFeatures(records) {
    const grid = document.querySelector('[data-cms-list="features"]');
    if (!grid) return;
    grid.replaceChildren();
    records.filter((record) => record.active).forEach((feature) => {
      const card = node('article', 'feature-card');
      if (feature.image && feature.imageVisible !== false) {
        const image = node('img');
        image.src = feature.image;
        image.alt = '';
        card.append(image);
      }
      const icon = node('div', 'icon-wrap');
      const iconElement = node('i');
      iconElement.setAttribute('data-lucide', feature.category || 'activity');
      icon.append(iconElement);
      card.append(icon, node('h3', '', feature.name), node('p', '', feature.description));
      grid.append(card);
    });
  }

  function renderPrograms(records) {
    const grid = document.querySelector('[data-cms-list="programs"]');
    if (!grid) return;
    grid.replaceChildren();
    records.filter((record) => record.active).forEach((program) => {
      const card = node('article', 'program-card');
      const visual = node('div', 'program-visual');
      if (program.image && program.imageVisible !== false) visual.style.backgroundImage = `url("${program.image}")`;
      const content = node('div', 'program-content');
      content.append(node('div', 'program-price', `${program.category || ''}${program.duration ? ` · ${program.duration}` : ''}`.trim()));
      content.append(node('h3', '', program.name), node('p', '', program.description));
      card.append(visual, content);
      grid.append(card);
    });
  }

  function renderTrainers(records) {
    const grid = document.querySelector('[data-cms-list="trainers"]');
    if (!grid) return;
    grid.replaceChildren();
    records.filter((record) => record.active).forEach((trainer) => {
      const card = node('article', 'trainer-card');
      if (trainer.image && trainer.imageVisible !== false) {
        const image = node('img');
        image.src = trainer.image;
        image.alt = trainer.name;
        card.append(image);
      }
      const content = node('div', 'trainer-content');
      content.append(node('div', 'trainer-meta', `${trainer.specialty || ''}${trainer.experience ? ` · ${trainer.experience}` : ''}`.trim()));
      content.append(node('h3', '', trainer.name), node('p', '', trainer.description));
      card.append(content);
      grid.append(card);
    });
  }

  function applyTheme(theme) {
    const root = document.documentElement;
    Object.entries(themeVariables).forEach(([key, variable]) => {
      if (theme[key]) root.style.setProperty(variable, theme[key]);
      else root.style.removeProperty(variable);
    });
    const pixelVariables = {
      headingSize: '--cms-heading-size',
      bodySize: '--cms-body-size',
      cardRadius: '--radius',
      featureImageHeight: '--cms-feature-image-height',
      programImageHeight: '--cms-program-image-height',
      trainerImageHeight: '--cms-trainer-image-height',
      sectionSpacing: '--cms-section-spacing'
    };
    Object.entries(pixelVariables).forEach(([key, variable]) => {
      if (theme[key] !== undefined) root.style.setProperty(variable, `${theme[key]}px`);
      else root.style.removeProperty(variable);
    });
    if (theme.font) root.style.setProperty('--cms-font', theme.font);
    else root.style.removeProperty('--cms-font');
    if (theme.fontWeight !== undefined) {
      root.style.setProperty('--cms-font-weight', theme.fontWeight);
    } else {
      root.style.removeProperty('--cms-font-weight');
    }
    const shadows = {
      none: 'none',
      soft: '0 20px 50px rgba(0, 0, 0, 0.35)',
      strong: '0 24px 60px rgba(0, 0, 0, 0.55)'
    };
    if (shadows[theme.cardShadow]) root.style.setProperty('--shadow', shadows[theme.cardShadow]);
    else root.style.removeProperty('--shadow');
  }

  function applyContent(content) {
    if (!content || !content.text) return;
    if (document.querySelector('[data-cms-section="home"]')) {
      document.body.classList.add('cms-public');
    }
    Object.entries(textTargets).forEach(([key, selector]) => {
      const element = document.querySelector(selector);
      if (!element || typeof content.text[key] !== 'string') return;
      removeTranslations(element);
      element.textContent = content.text[key];
    });
    if (document.querySelector('[data-cms-section="home"]') && content.text.siteTitle) {
      document.title = content.text.siteTitle;
    }
    const description = document.querySelector('meta[name="description"]');
    if (description && content.text.siteDescription) description.content = content.text.siteDescription;
    applyTheme(content.theme || {});
    document.querySelectorAll('[data-cms-section]').forEach((section) => {
      section.style.paddingBlock = 'var(--cms-section-spacing, 80px)';
    });
    renderFeatures(content.features || []);
    renderPrograms(content.programs || []);
    renderTrainers(content.trainers || []);

    Object.entries(content.visibility || {}).forEach(([section, visible]) => {
      const element = document.querySelector(`[data-cms-section="${section}"]`);
      if (element) element.hidden = !visible;
    });
    const main = document.querySelector('main');
    if (main && Array.isArray(content.order)) {
      content.order.forEach((section) => {
        const element = main.querySelector(`[data-cms-section="${section}"]`);
        if (element) main.append(element);
      });
    }

    const heroImage = content.imageVisibility?.hero !== false && content.images && content.images.hero;
    const visual = document.querySelector('.visual-graphic');
    if (visual) {
      visual.style.backgroundImage = heroImage
        ? `linear-gradient(140deg, rgba(37,46,68,0.6), rgba(12,17,27,0.2)), url("${heroImage}")`
        : '';
    }
    const heroBackground = content.imageVisibility?.heroBackground !== false && content.images && content.images.heroBackground;
    const hero = document.querySelector('[data-cms-section="home"]');
    if (hero) {
      hero.style.backgroundImage = heroBackground
        ? `linear-gradient(rgba(11,15,25,.75), rgba(11,15,25,.82)), url("${heroBackground}")`
        : '';
      hero.style.backgroundSize = heroBackground ? 'cover' : '';
      hero.style.backgroundPosition = heroBackground ? 'center' : '';
    }
    const aboutImage = content.imageVisibility?.about !== false && content.images && content.images.about;
    const about = document.querySelector('[data-cms-section="about"]');
    if (about) {
      about.style.backgroundImage = aboutImage
        ? `linear-gradient(rgba(11,15,25,.76), rgba(11,15,25,.88)), url("${aboutImage}")`
        : '';
      about.style.backgroundSize = aboutImage ? 'cover' : '';
      about.style.backgroundPosition = aboutImage ? 'center' : '';
    }
    if (window.lucide) window.lucide.createIcons();
  }

  async function loadPublishedContent() {
    const preview = new URLSearchParams(window.location.search).get('preview') === '1';
    let response;
    try {
      response = await fetch(`/api/site${preview ? '?preview=1' : ''}`, {
        credentials: 'same-origin',
        headers: { Accept: 'application/json' },
        cache: 'no-store'
      });
    } catch (error) {
      if (error instanceof TypeError) {
        throw new Error('Tidak dapat terhubung ke server FitMetric. Jalankan `py -3 server.py` dan buka website melalui server tersebut.');
      }
      throw error;
    }
    if (!response.headers.get('content-type')?.toLowerCase().includes('application/json')) {
      throw new Error(`Server mengirim respons non-JSON (HTTP ${response.status}). Jalankan FitMetric dengan \`py -3 server.py\`, bukan Live Server.`);
    }
    if (!response.ok) throw new Error(`Website content could not be loaded (${response.status}).`);
    let result;
    try {
      result = await response.json();
    } catch {
      throw new Error('Server FitMetric mengirim JSON konten yang tidak valid.');
    }
    applyContent(result.content);
    if (!preview) publishedContentSignature = JSON.stringify(result.content);
    if (preview) document.documentElement.dataset.preview = 'true';
  }

  async function refreshPublishedContent() {
    const response = await fetch('/api/site', {
      credentials: 'same-origin',
      headers: { Accept: 'application/json' },
      cache: 'no-store'
    });
    if (!response.ok || !response.headers.get('content-type')?.toLowerCase().includes('application/json')) {
      throw new Error(`Website content refresh failed (${response.status}).`);
    }
    const result = await response.json();
    const signature = JSON.stringify(result.content);
    if (signature !== publishedContentSignature) {
      applyContent(result.content);
      publishedContentSignature = signature;
    }
  }

  document.addEventListener('DOMContentLoaded', () => {
    loadPublishedContent().catch((error) => {
      console.error('FitMetric CMS content load failed:', error);
      if (new URLSearchParams(window.location.search).get('preview') === '1') {
        document.documentElement.dataset.previewError = 'true';
      }
    });
    if (
      new URLSearchParams(window.location.search).get('preview') !== '1' &&
      document.querySelector('[data-cms-section="home"]')
    ) {
      window.setInterval(() => {
        if (!document.hidden) {
          refreshPublishedContent().catch((error) => {
            console.warn('FitMetric CMS content refresh failed:', error);
          });
        }
      }, 10000);
    }
  });
})();
