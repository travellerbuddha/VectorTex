import { cookies } from 'next/headers';

export type AdminLocale = 'tr' | 'en';

const tr = {
  brand: 'TexHoliday Yönetim',
  lang: 'English',
  nav: {
    label: 'Yönetim menüsü',
    home: 'Ana sayfa',
    orders: 'Siparişler',
    tasks: 'Görevler',
    pricing: 'Fiyat politikası',
    staff: 'Personel',
    permissions: 'İzinler',
    signOut: 'Çıkış',
  },
  signIn: {
    title: 'Yönetim girişi',
    email: 'E-posta',
    password: 'Şifre',
    submit: 'Devam',
    failed: 'Giriş yapılamadı. E-posta veya şifre hatalı ya da hesap geçici olarak kilitli.',
    rate: 'Çok fazla deneme yapıldı. Birkaç dakika sonra tekrar deneyin.',
    expired: 'Oturumunuz sona erdi. Lütfen yeniden giriş yapın.',
    signedOut: 'Çıkış yaptınız.',
  },
  code: {
    title: 'Doğrulama kodu',
    intro: 'Authenticator uygulamanızdaki 6 haneli TexHoliday kodunu girin.',
    label: 'Kod',
    submit: 'Giriş yap',
    failed: 'Kod kabul edilmedi. Uygulamadaki güncel kodu girin. Çok sayıda hatalı deneme hesabı geçici olarak kilitler.',
  },
  enroll: {
    title: 'İki adımlı doğrulamayı kurun',
    intro: 'Yönetim paneline girişte şifrenin yanında telefonunuzdaki bir doğrulama uygulamasının kodu istenir.',
    step1: 'Telefonunuza Google Authenticator veya Microsoft Authenticator uygulamasını kurun.',
    step2: 'Uygulamada “QR kodu tara” seçeneğiyle aşağıdaki kodu okutun.',
    step3: 'Uygulamanın gösterdiği 6 haneli kodu girin.',
    manual: 'QR kodu okutamıyorsanız bu anahtarı elle girin:',
    qrAlt: 'Authenticator uygulaması için QR kod',
    submit: 'Kurulumu tamamla',
    failed: 'Kod doğrulanamadı. Telefonunuzun saatinin otomatik ayarlı olduğundan emin olun ve güncel kodu girin.',
  },
  setup: {
    title: 'Hesabınızı kurun',
    resetTitle: 'Yeni şifre belirleyin',
    hello: (name: string) => `Merhaba ${name}.`,
    password: 'Yeni şifre',
    passwordHint: (n: number) => `En az ${n} karakter. Uzun bir cümle kullanabilirsiniz. E-posta adınızı içermemeli.`,
    confirm: 'Yeni şifre (tekrar)',
    mismatch: 'İki şifre aynı değil.',
    weak: (n: number) => `Şifre en az ${n} karakter olmalı ve e-posta adınızı içermemeli.`,
    submit: 'Şifreyi kaydet',
    invalid: 'Bu bağlantı geçersiz, kullanılmış ya da süresi dolmuş. Yöneticinizden yeni bir bağlantı isteyin.',
  },
  home: {
    title: (name: string) => `Hoş geldiniz, ${name}`,
    noPermissions: 'Hesabınıza henüz bir izin verilmemiş. İzin vermesi için yöneticinize başvurun.',
    sections: 'Erişebildiğiniz bölümler',
  },
  noAccess: 'Bu sayfayı görüntüleme izniniz yok.',
};

type Dict = typeof tr;

const en: Dict = {
  brand: 'TexHoliday Admin',
  lang: 'Türkçe',
  nav: {
    label: 'Admin menu',
    home: 'Home',
    orders: 'Orders',
    tasks: 'Tasks',
    pricing: 'Pricing policy',
    staff: 'Staff',
    permissions: 'Permissions',
    signOut: 'Sign out',
  },
  signIn: {
    title: 'Admin sign-in',
    email: 'Email',
    password: 'Password',
    submit: 'Continue',
    failed: 'Sign-in failed. The email or password is wrong, or the account is temporarily locked.',
    rate: 'Too many attempts. Try again in a few minutes.',
    expired: 'Your session has ended. Please sign in again.',
    signedOut: 'You have signed out.',
  },
  code: {
    title: 'Verification code',
    intro: 'Enter the 6-digit TexHoliday code from your authenticator app.',
    label: 'Code',
    submit: 'Sign in',
    failed: 'The code was not accepted. Enter the current code from the app. Many failed attempts lock the account for a while.',
  },
  enroll: {
    title: 'Set up two-step verification',
    intro: 'Signing in to the admin needs your password and a code from an authenticator app on your phone.',
    step1: 'Install Google Authenticator or Microsoft Authenticator on your phone.',
    step2: 'In the app, choose “Scan a QR code” and scan the code below.',
    step3: 'Enter the 6-digit code the app shows.',
    manual: 'If you cannot scan the QR code, enter this key manually:',
    qrAlt: 'QR code for the authenticator app',
    submit: 'Finish setup',
    failed: 'The code could not be verified. Make sure your phone sets its clock automatically and enter the current code.',
  },
  setup: {
    title: 'Set up your account',
    resetTitle: 'Choose a new password',
    hello: (name: string) => `Hello ${name}.`,
    password: 'New password',
    passwordHint: (n: number) => `At least ${n} characters. A long sentence works well. It must not contain your email name.`,
    confirm: 'New password (again)',
    mismatch: 'The passwords do not match.',
    weak: (n: number) => `The password needs at least ${n} characters and must not contain your email name.`,
    submit: 'Save password',
    invalid: 'This link is invalid, already used or expired. Ask your administrator for a new one.',
  },
  home: {
    title: (name: string) => `Welcome, ${name}`,
    noPermissions: 'Your account has no permissions yet. Ask your administrator to grant them.',
    sections: 'Sections you can open',
  },
  noAccess: 'You do not have permission to view this page.',
};

export function adminDict(locale: AdminLocale): Dict {
  return locale === 'en' ? en : tr;
}

/** Staff language: Turkish unless the person switched to English (cookie). */
export async function adminLocale(): Promise<AdminLocale> {
  return (await cookies()).get('th_admin_lang')?.value === 'en' ? 'en' : 'tr';
}
