(() => {
  const views = {
    overview: 'Dashboard Admin',
    home: 'Edit Beranda',
    features: 'Edit Halaman Fitur',
    programs: 'Edit Program',
    trainers: 'Edit Pelatih',
    about: 'Edit Halaman Tentang',
    images: 'Manajemen Gambar',
    theme: 'Warna dan Font',
    accounts: 'Manajemen Akun',
    settings: 'Pengaturan Website',
    activity: 'Riwayat Perubahan'
  };
  const sections = [
    { key: 'home', label: 'Beranda' },
    { key: 'features', label: 'Fitur' },
    { key: 'programs', label: 'Program' },
    { key: 'trainers', label: 'Pelatih' },
    { key: 'about', label: 'Tentang' }
  ];
  const themeFields = [
    ['background', 'Warna background website', 'color'],
    ['navBackground', 'Warna navigasi', 'color'],
    ['card', 'Warna background kartu', 'color'],
    ['text', 'Warna tulisan utama', 'color'],
    ['muted', 'Warna tulisan sekunder', 'color'],
    ['primary', 'Warna tombol utama', 'color'],
    ['secondary', 'Warna tombol sekunder', 'color'],
    ['accent', 'Warna aksen', 'color'],
    ['border', 'Warna border', 'color'],
    ['font', 'Jenis font', 'font'],
    ['fontWeight', 'Ketebalan font', 'weight'],
    ['headingSize', 'Ukuran judul (px)', 'number'],
    ['bodySize', 'Ukuran deskripsi (px)', 'number'],
    ['cardRadius', 'Radius sudut kartu (px)', 'number'],
    ['cardShadow', 'Bayangan kartu', 'shadow'],
    ['featureImageHeight', 'Tinggi gambar fitur (px)', 'number'],
    ['programImageHeight', 'Tinggi gambar program (px)', 'number'],
    ['trainerImageHeight', 'Tinggi foto pelatih (px)', 'number'],
    ['sectionSpacing', 'Jarak antarbagian (px)', 'number']
  ];
  let content = null;
  let summary = null;
  let images = [];
  let dirty = false;
  let toastTimer;
  let nextFieldId = 0;

  const $ = (selector, root = document) => root.querySelector(selector);
  const workspace = $('#workspace');
  const escapePath = (value) => encodeURIComponent(value);

  function element(tag, className, text) {
    const item = document.createElement(tag);
    if (className) item.className = className;
    if (text !== undefined) item.textContent = text;
    return item;
  }

  async function api(path, options = {}) {
    let response;
    try {
      response = await fetch(path, {
        method: options.method || 'GET',
        credentials: 'same-origin',
        headers: { Accept: 'application/json', ...(options.body === undefined ? {} : { 'Content-Type': 'application/json' }) },
        body: options.body === undefined ? undefined : JSON.stringify(options.body)
      });
    } catch (error) {
      if (error instanceof TypeError) {
        throw new Error('Tidak dapat terhubung ke server FitMetric. Jalankan `py -3 server.py`, lalu buka website dari alamat server (bukan file:// atau Live Server).');
      }
      throw error;
    }

    if (!response.headers.get('content-type')?.toLowerCase().includes('application/json')) {
      throw new Error(`Server mengirim respons non-JSON (HTTP ${response.status}). Pastikan aplikasi dibuka dari server FitMetric dengan ` +
        '`py -3 server.py`, bukan dari file:// atau Live Server.');
    }

    let result;
    try {
      result = await response.json();
    } catch {
      throw new Error('Server mengirim JSON yang tidak valid. Periksa terminal server FitMetric untuk detail error.');
    }
    if (!response.ok) {
      const requestError = new Error(result?.error || 'Permintaan tidak dapat diselesaikan.');
      requestError.status = response.status;
      throw requestError;
    }
    return result;
  }

  function notify(message) {
    const toast = $('#adminToast');
    toast.textContent = message;
    toast.classList.add('show');
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => toast.classList.remove('show'), 3200);
  }

  function setDirty(value) {
    dirty = value;
    const indicator = $('#saveState');
    indicator.classList.toggle('is-dirty', dirty);
    indicator.lastChild.textContent = dirty ? 'Draft belum disimpan' : 'Semua perubahan tersimpan';
  }

  function setValue(object, key, value) {
    object[key] = value;
    setDirty(true);
  }

  function field(label, value, options = {}) {
    const wrapper = element('div', `field${options.full ? ' full' : ''}`);
    const caption = element('label', '', label);
    const control = options.multiline ? element('textarea') : element('input');
    control.id = `admin-field-${++nextFieldId}`;
    caption.htmlFor = control.id;
    if (options.type) control.type = options.type;
    if (options.min !== undefined) control.min = options.min;
    if (options.max !== undefined) control.max = options.max;
    if (options.step) control.step = options.step;
    if (options.placeholder) control.placeholder = options.placeholder;
    control.value = value ?? '';
    wrapper.append(caption, control);
    if (options.hint) wrapper.append(element('small', '', options.hint));
    return { wrapper, control };
  }

  function addPanel(title, description) {
    const panel = element('section', 'panel');
    const heading = element('div', 'panel-heading');
    const group = element('div');
    group.append(element('h2', '', title));
    if (description) group.append(element('p', '', description));
    heading.append(group);
    panel.append(heading);
    workspace.append(panel);
    return panel;
  }

  function heading(title, description, kicker = 'WEBSITE CONTENT') {
    const container = element('div', 'page-heading');
    const text = element('div');
    text.append(element('div', 'eyebrow', kicker), element('h1', '', title), element('p', '', description));
    container.append(text);
    workspace.append(container);
  }

  function currentView() {
    return $('#adminNav button.active')?.dataset.view || 'overview';
  }

  function render() {
    if (!content) return;
    const view = currentView();
    $('#currentPageLabel').textContent = views[view];
    workspace.replaceChildren();
    if (view === 'overview') renderOverview();
    else if (view === 'home') renderHome();
    else if (view === 'features') renderRecords('features');
    else if (view === 'programs') renderRecords('programs');
    else if (view === 'trainers') renderRecords('trainers');
    else if (view === 'about') renderAbout();
    else if (view === 'theme') renderTheme();
    else if (view === 'settings') renderSettings();
    else if (view === 'images') renderImages();
    else if (view === 'accounts') renderAccounts();
    else if (view === 'activity') renderActivity();
    if (window.lucide) window.lucide.createIcons();
  }

  function renderOverview() {
    heading(`Halo, ${summary?.admin?.name || 'Admin'}`, 'Ringkasan konten, akun, dan aktivitas website FitMetric.', 'ADMIN OVERVIEW');
    const stats = element('div', 'stat-grid');
    [
      ['Total Anggota', summary?.counts?.members ?? '—'],
      ['Pelatih Pribadi', summary?.counts?.trainers ?? '—'],
      ['Program Aktif', summary?.counts?.programs ?? '—'],
      ['Gambar Tersimpan', summary?.counts?.images ?? '—']
    ].forEach(([label, value]) => {
      const card = element('article', 'stat-card');
      card.append(element('span', '', label), element('strong', '', String(value)), element('em', '', 'Data tersimpan di SQLite'));
      stats.append(card);
    });
    workspace.append(stats);
    const panel = addPanel('Akses cepat', 'Pilih bagian website yang ingin Anda kelola.');
    const shortcuts = element('div', 'shortcut-grid');
    [
      ['home', 'Edit Beranda', 'Judul, deskripsi, statistik, dan gambar', 'panels-top-left'],
      ['programs', 'Program Latihan', 'Kelola katalog program publik', 'dumbbell'],
      ['trainers', 'Data Pelatih', 'Profil, spesialisasi, dan foto', 'users-round'],
      ['theme', 'Warna dan Font', 'Atur identitas visual website', 'palette'],
      ['images', 'Manajemen Gambar', 'Upload dan gunakan gambar website', 'images'],
      ['activity', 'Riwayat Perubahan', 'Lihat aktivitas administrator', 'history']
    ].forEach(([view, title, description, iconName]) => {
      const button = element('button', 'shortcut');
      button.type = 'button';
      const icon = element('span', 'shortcut-icon');
      const iconElement = element('i');
      iconElement.setAttribute('data-lucide', iconName);
      icon.append(iconElement);
      const copy = element('span');
      copy.append(element('strong', '', title), element('small', '', description));
      button.append(icon, copy);
      button.addEventListener('click', () => selectView(view));
      shortcuts.append(button);
    });
    panel.append(shortcuts);
    const status = addPanel('Status publikasi', 'Perubahan yang disimpan sebagai draft belum terlihat oleh pengunjung.');
    status.append(element('p', 'field-hint', dirty ? 'Ada perubahan lokal yang belum disimpan.' : 'Website menggunakan konten yang terakhir dipublikasikan.'));
  }

  function renderHome() {
    heading('Konten halaman beranda', 'Edit teks utama, ajakan bertindak, statistik progres, dan metadata website.');
    const panel = addPanel('Hero dan statistik', 'Perubahan ini tampil pada halaman utama setelah dipublikasikan.');
    const form = element('div', 'form-grid');
    [
      ['heroTitle', 'Judul utama', true],
      ['heroDescription', 'Deskripsi utama', true],
      ['heroButton', 'Tulisan tombol utama', false],
      ['heroSecondaryButton', 'Tulisan tombol sekunder', false],
      ['statMembers', 'Statistik anggota', false],
      ['statProgress', 'Statistik progres', false],
      ['statRating', 'Rating pelatih', false],
      ['siteTitle', 'Judul tab website', false],
      ['siteDescription', 'Deskripsi website (SEO)', true]
    ].forEach(([key, label, multiline]) => {
      const entry = field(label, content.text[key], { multiline, full: key === 'heroTitle' || key === 'heroDescription' });
      entry.control.addEventListener('input', () => setValue(content.text, key, entry.control.value));
      form.append(entry.wrapper);
    });
    panel.append(form);
    renderImageAssignment('hero', 'Gambar visual utama');
    renderImageAssignment('heroBackground', 'Gambar latar belakang beranda');
  }

  function renderAbout() {
    heading('Halaman Tentang', 'Kelola pesan dan narasi yang menjelaskan FitMetric kepada pengunjung.');
    const panel = addPanel('Konten Tentang');
    const form = element('div', 'form-grid');
    [
      ['aboutTitle', 'Judul halaman', false],
      ['aboutDescription', 'Deskripsi halaman', true],
      ['aboutBullet1', 'Poin penjelasan pertama', false],
      ['aboutBullet2', 'Poin penjelasan kedua', false]
    ].forEach(([key, label, multiline]) => {
      const entry = field(label, content.text[key], { multiline, full: multiline });
      entry.control.addEventListener('input', () => setValue(content.text, key, entry.control.value));
      form.append(entry.wrapper);
    });
    panel.append(form);
    renderImageAssignment('about', 'Gambar halaman Tentang');
    renderImageAssignment('hero', 'Gambar visual utama');
  }

  function renderRecords(collection) {
    const labels = { features: 'fitur', programs: 'program latihan', trainers: 'profil pelatih' };
    heading(`Kelola ${labels[collection]}`, `Tambah, edit, aktifkan, atau sembunyikan ${labels[collection]} pada website publik.`);
    const panel = addPanel(`Daftar ${labels[collection]}`, 'Simpan Perubahan langsung menerbitkan data; Preview Website menyimpan draft privat.');
    const records = content[collection];
    if (!records.length) panel.append(element('div', 'empty-message', `Belum ada ${labels[collection]}. Tambahkan item baru untuk mulai.`));
    records.forEach((record, index) => {
      const card = element('article', 'record-card');
      const top = element('div', 'record-head');
      top.append(element('strong', '', `${index + 1}. ${record.name || 'Item baru'}`));
      const remove = element('button', 'button button-danger button-small', 'Hapus');
      remove.type = 'button';
      remove.addEventListener('click', () => {
        content[collection].splice(index, 1);
        setDirty(true);
        render();
      });
      top.append(remove);
      card.append(top);
      const fields = element('div', 'record-fields');
      const definitions = collection === 'features'
        ? [['name', 'Nama fitur'], ['category', 'Ikon Lucide'], ['description', 'Deskripsi']]
        : collection === 'programs'
          ? [['name', 'Nama program'], ['category', 'Kategori'], ['duration', 'Durasi'], ['description', 'Deskripsi']]
          : [['name', 'Nama pelatih'], ['specialty', 'Spesialisasi'], ['experience', 'Pengalaman'], ['description', 'Deskripsi']];
      definitions.forEach(([key, label]) => {
        const multiline = key === 'description';
        const entry = field(label, record[key], { multiline, full: multiline });
        entry.control.addEventListener('input', () => {
          setValue(record, key, entry.control.value);
          top.querySelector('strong').textContent = `${index + 1}. ${record.name || 'Item baru'}`;
        });
        fields.append(entry.wrapper);
      });
      fields.append(renderImageEditor({
        label: collection === 'trainers' ? 'Foto profil' : collection === 'programs' ? 'Gambar program' : 'Gambar fitur',
        value: record.image,
        visible: record.imageVisible !== false,
        onChange: (value) => setValue(record, 'image', value),
        onVisibilityChange: (visible) => setValue(record, 'imageVisible', visible)
      }));
      const activeLabel = element('label', 'check-row');
      const active = element('input');
      active.type = 'checkbox';
      active.checked = record.active;
      active.addEventListener('change', () => setValue(record, 'active', active.checked));
      activeLabel.append(active, element('span', '', `Tampilkan ${collection === 'trainers' ? 'profil pelatih' : collection === 'programs' ? 'program' : 'fitur'} pada website publik`));
      card.append(fields, activeLabel);
      panel.append(card);
    });
    const addButton = element('button', 'button button-secondary', '');
    addButton.type = 'button';
    const icon = element('i');
    icon.setAttribute('data-lucide', 'plus');
    addButton.append(icon, document.createTextNode(` Tambah ${collection === 'trainers' ? 'pelatih' : collection === 'programs' ? 'program' : 'fitur'}`));
    addButton.addEventListener('click', () => {
      const id = `${collection.slice(0, -1)}-${crypto.randomUUID().slice(0, 8)}`;
      const record = collection === 'features'
        ? { id, name: '', category: 'activity', description: '', duration: '', image: '', imageVisible: true, active: true }
        : collection === 'programs'
          ? { id, name: '', category: '', description: '', duration: '', image: '', imageVisible: true, active: true }
          : { id, name: '', specialty: '', description: '', experience: '', image: '', imageVisible: true, active: true };
      content[collection].push(record);
      setDirty(true);
      render();
    });
    panel.append(addButton);
  }

  function imageName(source) {
    const stored = images.find((image) => `/uploads/${image.filename}` === source);
    if (stored) return stored.original_name;
    return source ? source.split('/').pop().split('?')[0] : 'Belum ada gambar dipilih';
  }

  function renderImageEditor({ label, value, visible, onChange, onVisibilityChange }) {
    const wrapper = element('div', 'field full image-editor');
    let currentValue = value;
    wrapper.append(element('label', '', label));

    const drop = element('div', 'upload-drop image-upload-drop');
    drop.setAttribute('aria-label', `Area upload ${label.toLowerCase()}`);
    const icon = element('i');
    icon.setAttribute('data-lucide', 'cloud-upload');
    const input = element('input');
    input.type = 'file';
    input.accept = 'image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp';
    input.hidden = true;
    const choose = element('button', 'button button-secondary', 'Pilih gambar dari komputer');
    choose.type = 'button';
    choose.addEventListener('click', () => input.click());
    drop.append(icon, element('strong', '', 'Unggah gambar baru'), element('p', '', 'JPG, JPEG, PNG, atau WebP · Maksimal 3 MB'), choose, input);
    const handleFile = async (file) => {
      const uploaded = await uploadImage(file, (url) => {
        currentValue = url;
        onChange(url);
      }, (previewUrl, filename) => updatePreview(previewUrl, filename));
      if (!uploaded) updatePreview(currentValue, imageName(currentValue));
    };
    wireImageDrop(drop, handleFile);
    input.addEventListener('change', () => {
      const file = input.files?.[0];
      input.value = '';
      if (file) handleFile(file);
    });

    const preview = element('div', 'image-selection-preview');
    const image = element('img', 'selected-image-preview');
    image.alt = `Preview ${label.toLowerCase()}`;
    const details = element('div', 'selected-image-details');
    const filename = element('strong');
    const description = element('small', '', 'Preview gambar yang akan digunakan');
    details.append(filename, description);
    const clear = element('button', 'button button-danger button-small', 'Hapus pilihan');
    clear.type = 'button';
    clear.addEventListener('click', () => {
      currentValue = '';
      onChange('');
      updatePreview('', imageName(''));
    });
    preview.append(image, details, clear);

    function updatePreview(source, name) {
      image.hidden = !source;
      image.src = source || '';
      filename.textContent = name;
      description.textContent = source ? 'Preview gambar yang akan digunakan' : 'Pilih gambar dari komputer atau Library';
      clear.hidden = !source;
      preview.classList.toggle('is-empty', !source);
    }

    const library = element('div', 'image-library-picker');
    library.append(element('strong', '', `Pilih dari Library Gambar (${images.length})`));
    if (!images.length) {
      library.append(element('p', 'field-hint', 'Belum ada gambar tersimpan di Library.'));
    } else {
      const grid = element('div', 'image-grid image-picker-grid');
      images.forEach((item) => {
        const source = `/uploads/${item.filename}`;
        const option = element('button', `image-choice${value === source ? ' is-selected' : ''}`);
        option.type = 'button';
        option.setAttribute('aria-pressed', String(value === source));
        const thumbnail = element('img');
        thumbnail.src = source;
        thumbnail.alt = '';
        option.append(thumbnail, element('span', '', item.original_name));
        option.addEventListener('click', () => {
          currentValue = source;
          onChange(source);
          updatePreview(source, item.original_name);
          grid.querySelectorAll('.image-choice').forEach((choice) => {
            const selected = choice === option;
            choice.classList.toggle('is-selected', selected);
            choice.setAttribute('aria-pressed', String(selected));
          });
        });
        grid.append(option);
      });
      library.append(grid);
    }

    const visibilityLabel = element('label', 'check-row image-visibility');
    const visibility = element('input');
    visibility.type = 'checkbox';
    visibility.checked = visible;
    visibility.addEventListener('change', () => onVisibilityChange(visibility.checked));
    visibilityLabel.append(visibility, element('span', '', 'Tampilkan pada website publik'));

    updatePreview(value, imageName(value));
    wrapper.append(drop, preview, library, visibilityLabel);
    return wrapper;
  }

  function renderImageAssignment(key, label) {
    const panel = addPanel(label, 'Unggah gambar baru atau gunakan gambar dari Library. File tersimpan permanen di server.');
    panel.append(renderImageEditor({
      label,
      value: content.images[key],
      visible: content.imageVisibility[key] !== false,
      onChange: (value) => setValue(content.images, key, value),
      onVisibilityChange: (visible) => setValue(content.imageVisibility, key, visible)
    }));
  }

  function renderTheme() {
    heading('Pengaturan warna dan font', 'Atur sistem desain dengan color picker dan kontrol visual. Preview dapat dilihat sebelum publikasi.', 'VISUAL DESIGN');
    const panel = addPanel('Desain website', 'Perubahan tema menggunakan CSS Variables pada seluruh website publik.');
    const form = element('div', 'form-grid');
    themeFields.forEach(([key, label, type]) => {
      const wrapper = element('div', 'field');
      const controlId = `admin-field-${++nextFieldId}`;
      const labelElement = element('label', '', label);
      labelElement.htmlFor = controlId;
      wrapper.append(labelElement);
      let control;
      if (type === 'font' || type === 'weight' || type === 'shadow') {
        control = element('select');
        const options = type === 'font'
          ? [['Poppins', 'Poppins'], ['Inter', 'Inter'], ['Arial', 'Arial'], ['system-ui', 'System UI']]
          : type === 'weight'
            ? [['400', 'Normal (400)'], ['500', 'Sedang (500)'], ['600', 'Tebal (600)'], ['700', 'Sangat tebal (700)'], ['800', 'Ekstra tebal (800)']]
            : [['none', 'Tanpa bayangan'], ['soft', 'Lembut'], ['strong', 'Kuat']];
        options.forEach(([value, label]) => control.append(new Option(label, value)));
        control.value = content.theme[key] ?? ({ font: 'Poppins', fontWeight: '400', cardShadow: 'soft' })[key];
      } else {
        control = element('input');
        control.type = type;
        if (type === 'number') {
          const limits = {
            headingSize: [24, 72], bodySize: [12, 24], cardRadius: [0, 40],
            featureImageHeight: [80, 360], programImageHeight: [80, 360],
            trainerImageHeight: [120, 480], sectionSpacing: [24, 160]
          };
          [control.min, control.max] = limits[key];
          control.step = '1';
          control.value = content.theme[key] ?? ({
            headingSize: 48, bodySize: 16, cardRadius: 20, featureImageHeight: 145,
            programImageHeight: 180, trainerImageHeight: 260, sectionSpacing: 80
          })[key];
        } else {
          control.value = content.theme[key] || ({
            background: '#0b0f19', card: '#151b2b', text: '#ffffff', muted: '#9ca3af',
            primary: '#a3ff12', accent: '#a3ff12', secondary: '#151b2b', border: '#292f3b',
            navBackground: '#0b0f19'
          })[key];
        }
      }
      control.id = controlId;
      control.addEventListener('input', () => setValue(
        content.theme,
        key,
        type === 'number' || type === 'weight' ? Number(control.value) : control.value
      ));
      wrapper.append(control);
      form.append(wrapper);
    });
    panel.append(form);
    const actions = element('div', 'panel-heading');
    actions.style.marginTop = '18px';
    const reset = element('button', 'button button-quiet', 'Reset ke Desain Awal');
    reset.type = 'button';
    reset.addEventListener('click', () => {
      content.theme = {};
      setDirty(true);
      render();
      notify('Tema draft dikembalikan ke desain awal.');
    });
    actions.append(reset);
    panel.append(actions);
    const note = element('p', 'field-hint', 'Preview menerapkan seluruh draft pada halaman utama, tetapi hanya admin yang dapat melihatnya sebelum dipublikasikan.');
    panel.append(note);
  }

  function renderSettings() {
    heading('Pengaturan website', 'Atur metadata website dan susunan konten. Perubahan susunan diterapkan pada website publik.');
    const metaPanel = addPanel('Informasi website');
    const form = element('div', 'form-grid');
    [
      ['siteTitle', 'Judul website'],
      ['siteDescription', 'Deskripsi SEO']
    ].forEach(([key, label]) => {
      const entry = field(label, content.text[key], { multiline: key === 'siteDescription', full: key === 'siteDescription' });
      entry.control.addEventListener('input', () => setValue(content.text, key, entry.control.value));
      form.append(entry.wrapper);
    });
    metaPanel.append(form);
    const sectionPanel = addPanel('Urutan dan visibilitas bagian', 'Gunakan nomor urutan dan status tampil untuk mengatur halaman publik.');
    const ordered = [...sections].sort((a, b) => content.order.indexOf(a.key) - content.order.indexOf(b.key));
    ordered.forEach((section, index) => {
      const row = element('div', 'section-settings');
      row.append(element('strong', '', section.label));
      const order = element('select');
      sections.forEach((_, position) => order.append(new Option(`Urutan ${position + 1}`, String(position))));
      order.value = String(index);
      order.addEventListener('change', () => {
        const next = [...content.order];
        const previousIndex = next.indexOf(section.key);
        const [item] = next.splice(previousIndex, 1);
        next.splice(Number(order.value), 0, item);
        content.order = next;
        setDirty(true);
        render();
      });
      const visibilityLabel = element('label', 'check-row');
      const visible = element('input');
      visible.type = 'checkbox';
      visible.checked = content.visibility[section.key];
      visible.setAttribute('aria-label', `Tampilkan bagian ${section.label}`);
      visible.addEventListener('change', () => setValue(content.visibility, section.key, visible.checked));
      visibilityLabel.append(visible, element('span', '', 'Tampil'));
      row.append(order, visibilityLabel);
      sectionPanel.append(row);
    });

    const navigationPanel = addPanel('Teks navigasi dan footer', 'Ubah label menu, tombol navigasi, dan tagline footer website.');
    const navigationForm = element('div', 'form-grid');
    [
      ['navHome', 'Menu: Beranda'],
      ['navFeatures', 'Menu: Fitur'],
      ['navPrograms', 'Menu: Program'],
      ['navTrainers', 'Menu: Pelatih'],
      ['navAbout', 'Menu: Tentang'],
      ['navLogin', 'Tombol: Masuk'],
      ['navRegister', 'Tombol: Daftar'],
      ['featuresEyebrow', 'Label bagian: Fitur'],
      ['programsEyebrow', 'Label bagian: Program'],
      ['trainersEyebrow', 'Label bagian: Pelatih'],
      ['aboutEyebrow', 'Label bagian: Tentang'],
      ['footerTagline', 'Tagline footer'],
      ['footerHome', 'Footer: Beranda'],
      ['footerFeatures', 'Footer: Fitur'],
      ['footerPrograms', 'Footer: Program'],
      ['footerTrainers', 'Footer: Pelatih'],
      ['footerLogin', 'Footer: Masuk'],
      ['aboutBullet3', 'Poin Tentang ketiga']
    ].forEach(([key, label]) => {
      const entry = field(label, content.text[key]);
      entry.control.addEventListener('input', () => setValue(content.text, key, entry.control.value));
      navigationForm.append(entry.wrapper);
    });
    navigationPanel.append(navigationForm);
  }

  function renderImages() {
    heading('Library gambar', 'Upload gambar permanen ke server FitMetric. Format JPG, JPEG, PNG, WebP; ukuran maksimal 3 MB.');
    const panel = addPanel('Upload gambar baru');
    const drop = element('div', 'upload-drop');
    const uploadIcon = element('i');
    uploadIcon.setAttribute('data-lucide', 'cloud-upload');
    drop.append(uploadIcon, element('strong', '', 'Pilih gambar dari komputer'), element('p', '', 'JPG, PNG, atau WebP · Maksimal 3 MB'));
    const pending = element('div', 'image-selection-preview is-empty');
    pending.hidden = true;
    const pendingImage = element('img', 'selected-image-preview');
    pendingImage.alt = 'Preview gambar yang akan diunggah';
    const pendingDetails = element('div', 'selected-image-details');
    const pendingName = element('strong');
    pendingDetails.append(pendingName, element('small', '', 'Preview file yang dipilih untuk diunggah'));
    pending.append(pendingImage, pendingDetails);
    const input = element('input');
    input.type = 'file';
    input.accept = 'image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp';
    input.hidden = true;
    const choose = element('button', 'button button-secondary', 'Pilih file');
    choose.type = 'button';
    choose.addEventListener('click', () => input.click());
    const handleFile = async (file) => {
      const uploaded = await uploadImage(file, null, (previewUrl, filename) => {
        pending.hidden = false;
        pending.classList.remove('is-empty');
        pendingImage.src = previewUrl;
        pendingName.textContent = filename;
      });
      if (!uploaded) pending.hidden = true;
    };
    input.addEventListener('change', () => {
      const file = input.files?.[0];
      input.value = '';
      if (file) handleFile(file);
    });
    wireImageDrop(drop, handleFile);
    drop.append(choose, input);
    panel.append(drop, pending);
    const library = addPanel(`Gambar tersimpan (${images.length})`, 'Gambar yang sedang digunakan tidak dapat dihapus sampai referensi draft/publikasi diganti.');
    if (!images.length) {
      library.append(element('div', 'empty-message', 'Belum ada gambar yang diunggah.'));
      return;
    }
    const grid = element('div', 'image-grid');
    images.forEach((image) => {
      const card = element('article', 'image-card');
      const preview = element('img');
      preview.src = `/uploads/${image.filename}`;
      preview.alt = image.original_name;
      const meta = element('div', 'image-meta');
      meta.append(element('strong', '', image.original_name), element('small', '', `${(image.size / 1024).toFixed(0)} KB · ${image.mime_type}`));
      const controls = element('div');
      const use = element('button', 'button button-secondary button-small', 'Gunakan untuk hero');
      use.type = 'button';
      use.addEventListener('click', () => {
        content.images.hero = `/uploads/${image.filename}`;
        setDirty(true);
        notify('Gambar hero telah dipilih untuk draft.');
      });
      const remove = element('button', 'button button-danger button-small', 'Hapus');
      remove.type = 'button';
      remove.style.marginLeft = '5px';
      remove.addEventListener('click', async () => {
        if (!window.confirm(`Hapus gambar "${image.original_name}"?`)) return;
        try {
          await api(`/api/admin/images/${escapePath(image.id)}`, { method: 'DELETE' });
          await loadImages();
          render();
          notify('Gambar berhasil dihapus.');
        } catch (error) {
          notify(error.message);
        }
      });
      controls.append(use, remove);
      meta.append(controls);
      card.append(preview, meta);
      grid.append(card);
    });
    library.append(grid);
  }

  function wireImageDrop(drop, onFile) {
    drop.addEventListener('dragover', (event) => {
      event.preventDefault();
      drop.classList.add('is-dragover');
    });
    drop.addEventListener('dragleave', (event) => {
      if (!event.relatedTarget || !drop.contains(event.relatedTarget)) drop.classList.remove('is-dragover');
    });
    drop.addEventListener('drop', (event) => {
      event.preventDefault();
      drop.classList.remove('is-dragover');
      const file = event.dataTransfer?.files?.[0];
      if (file) onFile(file);
    });
  }

  async function uploadImage(file, onUploaded, onPreview) {
    if (file.size > 3_000_000) {
      notify('Ukuran gambar melebihi batas 3 MB.');
      return false;
    }
    const validTypes = ['image/jpeg', 'image/png', 'image/webp'];
    const extension = file.name.split('.').pop()?.toLowerCase();
    if (!['jpg', 'jpeg', 'png', 'webp'].includes(extension) || (file.type && !validTypes.includes(file.type))) {
      notify('Pilih gambar JPG, JPEG, PNG, atau WebP.');
      return false;
    }
    let previewUrl = '';
    try {
      previewUrl = URL.createObjectURL(file);
      if (onPreview) onPreview(previewUrl, file.name);
      const dataUrl = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(new Error('File gambar gagal dibaca.'));
        reader.readAsDataURL(file);
      });
      const data = String(dataUrl).split(',')[1];
      const result = await api('/api/admin/images', { method: 'POST', body: { filename: file.name, data } });
      await loadImages();
      if (onUploaded) onUploaded(result.image.url);
      render();
      notify('Gambar berhasil diunggah dan tersimpan.');
      return true;
    } catch (error) {
      notify(error.message);
      return false;
    } finally {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    }
  }

  async function renderAccounts() {
    heading('Manajemen akun', 'Daftar akun anggota dan pelatih yang tersimpan. Peran akun tidak dapat diubah dari halaman publik.');
    const panel = addPanel('Akun FitMetric');
    try {
      const result = await api('/api/admin/accounts');
      const wrap = element('div', 'table-wrap');
      const table = element('table');
      const head = element('thead');
      const headRow = element('tr');
      ['Nama', 'Email', 'Peran', 'Tanggal dibuat'].forEach((label) => headRow.append(element('th', '', label)));
      head.append(headRow);
      const body = element('tbody');
      result.accounts.forEach((account) => {
        const row = element('tr');
        const name = element('td', '', account.name);
        const email = element('td', '', account.email);
        const role = element('td');
        role.append(element('span', 'role-pill', account.role === 'trainer' ? 'Pelatih' : 'Anggota'));
        const created = element('td', '', new Date(account.created_at).toLocaleDateString('id-ID'));
        row.append(name, email, role, created);
        body.append(row);
      });
      table.append(head, body);
      wrap.append(table);
      panel.append(wrap);
      if (!result.accounts.length) panel.append(element('div', 'empty-message', 'Belum ada akun anggota atau pelatih.'));
    } catch (error) {
      panel.append(element('div', 'empty-message', error.message));
    }
  }

  async function renderActivity() {
    heading('Riwayat perubahan', 'Aktivitas admin, publikasi, penyimpanan draft, dan pengelolaan media tercatat di database.');
    const panel = addPanel('Aktivitas terbaru');
    try {
      const result = await api('/api/admin/activity');
      if (!result.activity.length) {
        panel.append(element('div', 'empty-message', 'Belum ada aktivitas admin.'));
        return;
      }
      const wrap = element('div', 'table-wrap');
      const table = element('table');
      const head = element('thead');
      const headRow = element('tr');
      ['Aksi', 'Detail', 'Admin', 'Waktu'].forEach((label) => headRow.append(element('th', '', label)));
      head.append(headRow);
      const body = element('tbody');
      result.activity.forEach((activity) => {
        const row = element('tr');
        row.append(element('td', '', activity.action), element('td', '', activity.details || '—'),
          element('td', '', activity.admin_email), element('td', '', new Date(activity.created_at).toLocaleString('id-ID')));
        body.append(row);
      });
      table.append(head, body);
      wrap.append(table);
      panel.append(wrap);
    } catch (error) {
      panel.append(element('div', 'empty-message', error.message));
    }
  }

  async function loadImages() {
    const result = await api('/api/admin/images');
    images = result.images;
  }

  async function loadAdminWorkspace() {
    const [contentResult, summaryResult] = await Promise.all([
      api('/api/admin/content'),
      api('/api/admin/summary')
    ]);
    content = contentResult.content;
    summary = summaryResult;
    await loadImages();
    $('#loginScreen').hidden = true;
    $('#adminApp').hidden = false;
    setDirty(false);
    render();
  }

  function selectView(view) {
    if (!views[view]) return;
    $('#adminNav button.active')?.classList.remove('active');
    $(`#adminNav button[data-view="${view}"]`)?.classList.add('active');
    render();
    $('#adminApp .sidebar').classList.remove('mobile-open');
  }

  async function saveDraft() {
    await api('/api/admin/draft', { method: 'PUT', body: { content } });
    setDirty(false);
    notify('Draft berhasil disimpan di database.');
  }

  async function publishDraft() {
    if (dirty) await saveDraft();
    await api('/api/admin/publish', { method: 'POST', body: {} });
    summary = await api('/api/admin/summary');
    setDirty(false);
    notify('Perubahan berhasil dipublikasikan ke website.');
    render();
  }

  async function saveAndPublish() {
    await api('/api/admin/publish', { method: 'PUT', body: { content } });
    summary = await api('/api/admin/summary');
    setDirty(false);
    notify('Perubahan berhasil disimpan dan langsung ditampilkan di website.');
    render();
  }

  async function discardDraft() {
    if (!window.confirm('Batalkan draft dan muat ulang konten terakhir yang dipublikasikan?')) return;
    await api('/api/admin/discard', { method: 'POST', body: {} });
    await loadAdminWorkspace();
    notify('Draft dibatalkan. Konten publik tetap tidak berubah.');
  }

  async function openPreview() {
    try {
      if (dirty) await saveDraft();
      const modal = $('#previewModal');
      modal.hidden = false;
      modal.querySelector('iframe').src = `/index.html?preview=1&t=${Date.now()}`;
    } catch (error) {
      notify(error.message);
    }
  }

  async function logout() {
    try {
      await api('/api/admin/logout', { method: 'POST', body: {} });
      $('#adminApp').hidden = true;
      $('#loginScreen').hidden = false;
      $('#adminPassword').value = '';
      $('#loginError').textContent = '';
      content = null;
      notify('Anda telah keluar dari Admin Panel.');
    } catch (error) {
      notify(error.message);
    }
  }

  function wireEvents() {
    $('#adminLoginForm').addEventListener('submit', async (event) => {
      event.preventDefault();
      const loginForm = event.currentTarget;
      $('#loginError').textContent = '';
      const form = new FormData(loginForm);
      try {
        await api('/api/admin/login', {
          method: 'POST',
          body: { email: form.get('email'), password: form.get('password') }
        });
        loginForm.reset();
        await loadAdminWorkspace();
      } catch (error) {
        $('#loginError').textContent = error.message;
      }
    });
    $('#adminNav').addEventListener('click', (event) => {
      const button = event.target.closest('[data-view]');
      if (button) selectView(button.dataset.view);
    });
    $('#saveButton').addEventListener('click', () => saveAndPublish().catch((error) => notify(error.message)));
    $('#publishButton').addEventListener('click', () => {
      if (window.confirm('Publikasikan perubahan draft ke website untuk semua pengunjung?')) {
        publishDraft().catch((error) => notify(error.message));
      }
    });
    $('#discardButton').addEventListener('click', () => discardDraft().catch((error) => notify(error.message)));
    $('#previewButton').addEventListener('click', openPreview);
    $('#logoutButton').addEventListener('click', logout);
    $('#mobileMenuButton').addEventListener('click', () => $('#adminApp .sidebar').classList.toggle('mobile-open'));
    document.querySelectorAll('[data-close-preview]').forEach((button) => {
      button.addEventListener('click', () => {
        $('#previewModal').hidden = true;
        $('#previewModal iframe').src = 'about:blank';
      });
    });
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') $('#previewModal').hidden = true;
    });
  }

  async function start() {
    wireEvents();
    if (window.lucide) window.lucide.createIcons();
    try {
      await loadAdminWorkspace();
    } catch (error) {
      if (error.status !== 401) $('#loginError').textContent = error.message;
    }
  }

  document.addEventListener('DOMContentLoaded', start);
})();
