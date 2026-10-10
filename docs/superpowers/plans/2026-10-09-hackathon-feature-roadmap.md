# Roadmap Fitur Hackathon: Agora PWA, Invoice Privat, Notifikasi Email

Disusun: 9 Oktober 2026
Branch kerja: `monad-migration`

## Ringkasan

Dokumen ini menyusun fitur yang akan dibangun sebelum submission Monad Metropolis.
Prioritasnya diambil dari bobot penilaian track Consumer Products & Payments dan
bounty yang bisa kita klaim.

| # | Fitur | Untuk | Perkiraan | Prioritas |
|---|---|---|---|---|
| 1 | PWA + kirim AUSD lintas negara | Bounty Agora ($10.000), Design & Craft | 1 hari | Tertinggi |
| 2 | Invoice privat | Market Readiness (25%), Design & Craft (20%) | 1,5 hari | Tinggi |
| 3 | Notifikasi email | Design & Craft, Traction | 1 hari | Tinggi |
| - | Onramp kartu via Privy | — | — | **Ditunda** (lihat bagian 5) |

> **Deadline: 13 Oktober 2026, 23:59 ET** (Rules §4.2, dikutip dari README
> peserta lain; header halaman Rise In menulis 12 Oktober). Hari ini 9 Oktober,
> jadi tersisa sekitar 4 hari. Video, repo publik dan link live juga harus siap
> sebelum itu. Pastikan tanggal pastinya ke penyelenggara.

## 0. Temuan riset yang mengubah rencana

1. **Bounty Privy tidak bisa digabung dengan bounty Mera.** Syaratnya
   "Integrate Privy beyond authentication — login-only integrations will not
   qualify", dan bounty ini disebut *mutually exclusive with Mera*. Karena kita
   sudah mengklaim Mera ($2.500), mengejar Privy berarti melepas Mera.
2. **Onramp kartu Privy hanya untuk mainnet.** Testnet tidak didukung, dan
   dukungan Monad di provider onramp (Meld, MoonPay, Coinbase) belum
   terkonfirmasi. Fitur ini tidak bisa didemokan di Monad testnet.
3. **Ada bounty Agora Cross-Border Payments ($10.000):** "Build a mobile app
   letting users send AUSD across borders using Mera passkey onboarding and
   instant settlement." Penyelenggara menjawab di forum: "Yes, a PWA qualifies."
   Meaw sudah punya pool AUSD, passkey Mera dan kirim privat antar `@username`.
   Kekurangannya terutama PWA dan alur kirim yang mobile-first.
4. Bounty lain yang relevan untuk nanti: **Aurora Intents ($5.000)** untuk
   deposit dari chain mana pun. Ini cocok dengan masalah "bayar dari chain lain"
   tapi berat untuk dikerjakan dalam 4 hari.

Sumber riset:

- Syarat bounty dikutip dari README peserta lain, jadi sifatnya second-hand.
  **Cek ulang teks resminya di halaman Prizes/Rules hackathon** sebelum
  mengubah klaim di `docs/hackathon.md`.
- [Monad Metropolis Hackathon (Rise In)](https://www.risein.com/monad/monad-metropolis-hackathon)
- [Merchant Rails README (kutipan rules bounty)](https://github.com/precious-akpan/monad-metropolis-merchant-rails)
- [Privy fiat onramp](https://docs.privy.io/wallets/funding/fiat-onramp)
- [Privy funding overview](https://docs.privy.io/wallets/funding/overview)

---

## 1. PWA + kirim AUSD lintas negara (bounty Agora)

### Tujuan

Meaw bisa di-install di HP sebagai app. User mendaftar dengan passkey (Mera),
lalu mengirim AUSD ke `@username` di negara lain dalam beberapa detik, secara
privat dan tanpa gas.

### Yang sudah ada

- **Pool AUSD:** `0x8b0015711517e2b2b7cdd430e11bc2a0e9cca092`, dengan
  `requestCapable` dan `transferCapable` aktif.
- **Kirim privat** ke `@username` (`features/transfers`), memakai merge/split
  proof dan relayer gasless.
- **Kunci privat dari passkey Mera** (PRF, HKDF namespaces). Seed phrase tidak
  pernah ada.
- **Settlement:** satu transaksi Monad.

### Yang perlu dibangun

1. **Web app manifest:** `web/src/app/manifest.ts` (Next.js Metadata API).
   - `name: "Meaw"`, `short_name: "Meaw"`, `start_url: "/dashboard"`,
     `display: "standalone"`, `background_color` dan `theme_color` sesuai
     dashboard.
   - Ikon 192 dan 512 dari `logo-bg.png` (kucing pixel), plus varian
     `maskable` dengan padding aman.
2. **Meta mobile:** atur `appleWebApp` (capable, title, statusBarStyle) di
   `layout.tsx`, `viewport.themeColor`, dan cek safe-area. Bottom nav di
   `DashboardShell` sudah memakai `env(safe-area-inset-bottom)`.
3. **Service worker (minimal):** cukup supaya app bisa di-install dan
   menampilkan halaman offline ber-maskot. **Jangan cache** response tRPC atau
   data note. Pakai `public/sw.js` yang ditulis tangan (sekitar 30 baris,
   network-first untuk navigasi plus fallback `/offline`), tanpa dependency baru.
4. **Alur "Send abroad" mobile-first:**
   - Pilih AUSD sebagai default saat mengirim dari HP (atau dari tombol "Send
     AUSD").
   - Input `@username`, nominal, lalu konfirmasi dan sukses dengan maskot
     `success`.
   - Tampilkan estimasi nilai di mata uang lokal penerima (misalnya "≈ Rp
     325.000"). Kurs cukup statis atau satu panggilan API kurs di server, dan
     diberi label "estimasi".
   - Tampilkan waktu settlement sebenarnya (misalnya "Settled in 1.2 s") dari
     submit sampai receipt.
5. **Install prompt:** banner kecil "Install Meaw" di dashboard mobile
   (`beforeinstallprompt`; di iOS tampilkan instruksi Share → Add to Home
   Screen). Bisa ditutup, dan statusnya disimpan di `localStorage`.

### Risiko dan hal yang perlu dicek

- **Teks syarat "Mera passkey onboarding":** saat ini login memakai Privy,
  sedangkan passkey Mera dipakai untuk kunci privat. Pastikan alur onboarding
  kita memenuhi syarat ini, atau tampilkan langkah passkey Mera dengan jelas di
  video demo.
- **AUSD di testnet masih mock.** Tanyakan ke penyelenggara apakah ini cukup
  untuk demo, dan sebutkan alamat AUSD mainnet (`0x00000000efe302be…`) di
  `lib/assets.ts` sebagai jalur produksi.
- **Gabungan bounty:** cek apakah bounty Agora boleh digabung dengan bounty
  Mera.

### Kriteria selesai

- [ ] Lighthouse "Installable" lolos; app terbuka standalone di Android dan iOS.
- [ ] Kirim 10 AUSD ke `@username` lain dari HP, berhasil, dengan waktu
      settlement tampil.
- [ ] Halaman offline tampil saat koneksi mati.
- [ ] Test: render manifest, dan komponen install prompt ditandai dismissed.

---

## 2. Invoice privat

### Tujuan

Freelancer membuat invoice sungguhan (nomor, klien, item, jatuh tempo), lalu
mengirim link-nya ke klien. Klien membayar dari halaman invoice, dan status
berubah otomatis menjadi **Paid** tanpa server tahu isi saldo atau riwayat
penerima.

### Kondisi sekarang

Belum ada fitur invoice. "Invoice" saat ini hanya payment link dengan nominal
tetap plus deskripsi (`server/modules/paymentLinks`). Receipt verification
sudah ada, tapi teksnya sendiri menyebut tidak membuktikan "invoice was paid".

### Desain status Paid (kunci privasinya)

Kita memakai pola yang sudah terbukti di **request privat**
(`features/requests/requestCrypto.ts`):

- Saat membuat invoice, browser penerbit membuat `salt` acak dan menghitung
  `commitment = poseidon(amount, notePubkey, salt)`, sama seperti
  `expectedCommitment`.
- `salt` bukan rahasia: memegang `salt` tidak bisa dipakai untuk membelanjakan
  note, karena itu tetap butuh note secret penerima. Penerima tidak perlu
  menyimpannya sendiri, karena deposit payer sudah membawa ciphertext note
  (termasuk `salt`) yang dienkripsi ke view key penerima, dan scanner menemukan
  note itu seperti pembayaran biasa.
- Halaman invoice publik (URL dengan token acak) memberi payer `salt` itu,
  sehingga deposit payer menghasilkan **tepat** `commitment` tersebut.
  `payIntoNote` perlu parameter `salt` opsional.
- Setelah deposit, payer mengirim `txHash`. Server memverifikasi event
  `Deposit` di pool yang benar dengan `commitment` sama dan konfirmasi cukup,
  lalu mengubah status menjadi `paid`. Ini sama dengan `verifyRequestReceipt`.
- Cron `pool-indexer` juga bisa menandai Paid kalau payer menutup tab sebelum
  mengirim `txHash`, dengan mencocokkan `commitment` di mirror deposits.

**Implikasi privasi (tulis jujur di UI dan docs):**

- Siapa pun yang memegang link invoice bisa mengaitkan satu deposit dengan
  invoice itu. Ini sama dengan klien yang memang tahu dia membayar.
- Server tahu invoice milik `@user` sudah lunas. Saat menarik dana nanti,
  penerima tetap tidak bisa dikaitkan karena nullifier tidak terhubung ke
  deposit.

### Data (MongoDB)

Migration baru: `web/migrations/20261009120000-invoices.js`. Formatnya ESM
(`export const up/down`), dengan index `{owner:1, createdAt:-1}`,
`{token:1}` unique dan `{commitment:1}` unique.

```ts
type InvoiceRecord = {
  _id: ObjectId;
  owner: string;            // @username penerbit
  number: string;           // "INV-2026-001", unik per owner
  token: string;            // 128-bit acak, untuk URL publik
  poolScope: PoolScope;     // menentukan asset (USDC/AUSD/USDT0/MUSD)
  amount: string;           // base units, total; server perlu untuk verifikasi
  commitment: Hex;          // poseidon(amount, notePubkey, salt)
  publicView: {             // yang boleh dilihat klien di halaman invoice
    clientName: string;
    clientEmail?: string;   // untuk email kuitansi (opsional)
    items: { description: string; quantity: number; unitPrice: string }[];
    notes?: string;
    dueDate: string;        // ISO date
  };
  salt: string;             // diberikan ke payer lewat halaman ber-token
  status: "draft" | "sent" | "paid" | "void";
  paidTx?: Hex;
  paidAt?: Date;
  createdAt: Date;
  updatedAt: Date;
};
```

> **Catatan desain:** `publicView` dan `salt` memang harus bisa dibaca payer.
> Yang dilindungi adalah keterkaitan invoice ini dengan saldo dan riwayat
> penerima. Kalau ingin menyembunyikan detail invoice dari server juga, enkripsi
> `publicView` dengan kunci simetris yang ditaruh di fragment URL (`#k=...`).
> Fragment tidak terkirim ke server. Ini opsional dan bisa jadi nilai plus untuk
> cerita Mera atau privasi.

### Server

Modul baru `web/src/server/modules/invoices/` mengikuti pola repo:

- **`invoices.schema.ts`:** zod untuk create, update, publicGet dan markPaid.
  Validasi nominal memakai helper decimal → base units yang sudah ada di
  `paymentLinks.schema.ts`, termasuk decimals per asset.
- **`invoices.service.ts`:** `create`, `list(owner)`, `get(owner, id)`,
  `getPublic(token)`, `void`, dan `confirmPayment(token, txHash)` yang
  memverifikasi receipt.
- **`invoices.router.ts`:** create, list dan void memakai `protectedProcedure`
  dan memastikan owner sama dengan user login. `getPublic` dan `confirmPayment`
  memakai `publicProcedure` plus rate limit.
- **`invoices.errors.ts`:** `InvoiceNotFound`, `InvoiceAlreadyPaid`,
  `InvoicePaymentMismatch`.
- Daftarkan di `server/root.ts`.

### Web

- **Dashboard → tab "Invoices"** (`/invoices`):
  - Daftar invoice dengan status badge: Draft, Sent, Paid, dan Overdue (status
    turunan dari `dueDate`).
  - Empty state memakai maskot `idle`.
  - Tombol "New invoice" membuka dialog dengan baris item dinamis, subtotal
    otomatis, pilihan asset (komponen `ui/select` + `CoinIcon`) dan jatuh tempo.
  - Aksi per invoice: Copy link, QR (pakai ulang `PaymentQrDialog`), Download
    PDF, Void.
- **Halaman publik `/i/[token]`:**
  - Layout seperti invoice kertas: logo kucing, nomor, tanggal, tabel item dan
    total.
  - Tombol bayar memakai ulang komponen bayar dari `PayForm`, termasuk payer
    email checkout.
  - Setelah lunas: maskot `success` dan cap "PAID".
- **PDF:** pakai ulang `lib/disclosurePdf.ts` untuk "Invoice" dan "Receipt
  (Paid)".

### Kriteria selesai

- [ ] Buat invoice USDC dan AUSD, bayar dari browser lain, status berubah jadi
      Paid dalam 1 menit.
- [ ] Tab ditutup sebelum `confirmPayment` → cron tetap menandai Paid.
- [ ] `txHash` palsu atau commitment berbeda ditolak (`InvoicePaymentMismatch`).
- [ ] Invoice yang sudah lunas tidak bisa dibayar dua kali (UI dan server).
- [ ] Test: schema, `confirmPayment` (cocok, tidak cocok, sudah lunas), migration
      idempotent, render halaman publik.

---

## 3. Notifikasi email

### Tujuan

User langsung tahu lewat email kalau ada uang masuk atau tagihan, tanpa harus
membuka dashboard, dan tanpa email itu membocorkan detail finansial.

### Prinsip privasi

- **Opt-in:** default **mati**, diaktifkan di Settings.
- **Isi email minimal:** tidak menyebut nominal untuk pembayaran yang nominalnya
  memang tidak diketahui server (link terbuka, transfer privat, request). Email
  hanya menyebut nominal kalau server sudah tahu dari data yang ada (invoice).
  Tidak ada alamat wallet maupun tx hash di email.
- **Tombol "Open Meaw":** semua detail dilihat di app setelah unlock.
- **Unsubscribe satu klik:** token per user di footer email.

### Provider

**Resend** lewat satu `fetch` ke `https://api.resend.com/emails`, tanpa SDK.

- Env server baru di `env.server.ts` dan `.env.example`:
  - `RESEND_API_KEY` (opsional; kalau kosong, notifikasi dimatikan tanpa error)
  - `EMAIL_FROM` (misalnya `Meaw <hello@meaw.xyz>`; domain perlu diverifikasi di
    Resend)
  - `APP_URL` (untuk link di email)
- Tambahkan juga ke compose dan secrets deploy.
- Template email berupa HTML inline sederhana dengan logo kucing dan satu
  tombol, plus versi teks polos.

### Alamat email user

- Ambil dari akun email yang terhubung di Privy (lewat `@privy-io/node`, user
  dari `privyUserId`), lalu tampilkan di Settings untuk dikonfirmasi atau
  diubah.
- Simpan di koleksi baru `notification_settings`:
  `{ owner, email, enabled, events: {...}, unsubscribeToken, updatedAt }`.
  Pakai migration ESM dengan index unique `owner` dan `unsubscribeToken`.

### Event dan isi email

| Event | Pemicu (server tahu dari mana) | Isi email |
|---|---|---|
| Invoice lunas | `invoices.confirmPayment` atau cron | "Invoice INV-001 sudah dibayar: 250 USDC" |
| Kuitansi ke klien | sama, kalau `clientEmail` ada | "Pembayaran kamu ke @dinar sudah diterima" + PDF |
| Request baru untuk kamu | `requests.create` (addressee diketahui) | "@budi meminta pembayaran. Buka Meaw untuk melihat detailnya." |
| Request kamu dibayar | status request menjadi `paid` | "Request kamu sudah dibayar." |
| Pembayaran via link | lihat catatan di bawah | "Ada pembayaran baru masuk 🐱" |
| Transfer privat masuk | operasi transfer tercatat di server | "Ada pembayaran privat baru masuk." |

**Catatan pembayaran via payment link:** server tidak bisa tahu deposit privat
ditujukan ke siapa. Setelah deposit terkonfirmasi, browser payer memanggil
`notifications.paymentArrived({ username, linkSlug, txHash })`. Server
memverifikasi bahwa tx berisi event `Deposit` di pool yang aktif dalam 10 menit
terakhir, lalu membuang `txHash` (tidak disimpan) dan mengirim email tanpa
nominal. Server memang sudah tahu link mana yang dibuka, jadi kebocoran
tambahannya kecil. Tetap tulis hal ini di halaman privacy.

### Pengiriman

- Fungsi `sendEmail()` di `server/lib/email.ts`, dipanggil setelah status
  tersimpan di database (bukan sebelumnya).
- Idempoten: catat `notification_log` `{ eventKey, sentAt }` dengan index unique
  `eventKey`, misalnya `invoice-paid:<id>`, supaya cron dan `confirmPayment`
  tidak mengirim dua kali.
- Kegagalan email **tidak** menggagalkan operasi utama. Cukup log, lalu coba
  lagi di run cron berikutnya.
- Rate limit per penerima, misalnya maksimal 20 email per jam, untuk mencegah
  spam lewat `paymentArrived`.

### Web

- **Settings → "Email notifications":** field email (prefill dari Privy), toggle
  per event, tombol "Send test email".
- **Halaman `/unsubscribe/[token]`:** konfirmasi berhenti berlangganan, dengan
  maskot.

### Kriteria selesai

- [ ] Toggle aktif → bayar invoice → email "Invoice lunas" sampai dalam 1 menit.
- [ ] Tanpa `RESEND_API_KEY`, semua alur tetap jalan dan Settings menampilkan
      "Email belum dikonfigurasi".
- [ ] Event yang sama tidak terkirim dua kali.
- [ ] Unsubscribe mematikan semua email user itu.
- [ ] Test: builder isi email (tanpa nominal untuk event privat),
      idempotensi log, rate limit, `paymentArrived` menolak tx palsu.

---

## 4. Urutan kerja (4 hari)

| Hari | Fokus | Hasil |
|---|---|---|
| Kam 9 Okt | Konfirmasi syarat bounty Agora dan Privy/Mera ke penyelenggara; deploy production + link live | Link publik untuk juri |
| Jum 10 Okt | PWA (manifest, ikon, SW, install prompt) + alur Send AUSD mobile | Bounty Agora siap didemokan |
| Sab 11 Okt | Invoice privat (server, migration, dashboard, halaman publik) | Invoice sampai status Paid |
| Min 12 Okt | Notifikasi email (Resend, Settings, event invoice/request) + PDF invoice | Email terkirim |
| Sen 13 Okt | Rekam video demo dan pitch, update `docs/hackathon.md` + README, buka repo, submit sebelum 23:59 ET | Submission lengkap |

Kalau waktu mepet, potong dari bawah: event email selain invoice, PDF invoice,
lalu install prompt. **Jangan potong** link live, video, dan PWA dasar.

## 5. Yang ditunda

- **Onramp kartu (Privy):** hanya untuk mainnet, dan bounty Privy tidak bisa
  digabung dengan Mera. Kerjakan setelah ada deploy mainnet.
- **Aurora Intents (bayar dari chain lain), $5.000:** relevan tapi butuh
  integrasi baru. Kandidat setelah hackathon.
- **Langganan / retainer, split payment, kontak privat:** ide bagus, tapi tidak
  muat dalam 4 hari.

## 6. Update dokumen setelah selesai

- `docs/hackathon.md`: tambah klaim bounty Agora (kalau dikonfirmasi), update
  status deliverables, dan perbarui demo plan (invoice, lalu email, lalu kirim
  AUSD dari HP).
- `README.md`: tambah fitur invoice dan notifikasi, env baru, dan cara install
  PWA.
- `docs/features.md`, `docs/practical-privacy.md`: jelaskan apa yang server
  ketahui dari invoice dan notifikasi.
- `web/.env.example`: tambah `RESEND_API_KEY`, `EMAIL_FROM`, `APP_URL`.
