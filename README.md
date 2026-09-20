# PS5 Ethernet paylaşımı — otomatik macOS servisi

Mac'in Wi-Fi bağlantısını, kayıtlı USB Ethernet adaptörü üzerinden PS5'e paylaşır.
`launchd` altında çalışan Swift servis adaptör, ağ ve güç olaylarını izler.
Terminal veya oturum kilidini açmak normal kullanımda gerekmez. Kurulum yönetici yetkisi ister.

## Davranış

Paylaşım yalnızca şu koşullar birlikte sağlanınca başlar:

- ASIX `0x0b95:0x1790`, seri `0074EE11`, MAC `9c:69:d3:74:ee:11` adaptörü takılıdır.
- Ethernet link'i aktiftir; PS5/kablo bağlıdır.
- Mac AC güçtedir.
- Birincil IPv4 çıkışı `en0` Wi-Fi'dır ve link-local olmayan bir IPv4 adresi vardır.
- Otomasyon manuel olarak duraklatılmamıştır.

`en9` sabitlenmez; arayüz kimlik üzerinden bulunur. Wi-Fi SSID kontrolü yapılmaz:
eduroam dışındaki bir Wi-Fi ağı da koşulları sağlayabilir. VPN'in birincil arayüzü
değiştirdiği durumlarda paylaşım kapanır; eşzamanlı VPN/Internet Sharing kullanımını desteklemiyoruz.

| Senaryo | Davranış |
| --- | --- |
| Mac uyanık veya kilit ekranında, adaptör takılıyor | Koşullar sağlanınca otomatik başlar |
| Adaptör Mac uyurken takılıyor, sonra kapak açılıyor | Uyanınca mevcut cihazlar yeniden taranır; en geç yaklaşık 10 saniye içinde değerlendirilir |
| Paylaşım aktifken, AC güçte kapak kapanıyor | Geçici `SleepDisabled` ayarıyla paylaşım sürdürülür |
| Adaptör, Ethernet link'i, AC güç veya Wi-Fi çıkışı kayboluyor | Paylaşım temizlenir; kapak kapalıysa ardından uyku istenir |
| Adaptör yok | Uyku ayarlarına dokunulmaz; uyanma zamanlayıcısı kurulmaz |
| Servis çöküyor veya yeniden başlatılıyor | Kalıcı journal okunur, eski oturum temizlenir, koşullar yeniden değerlendirilir |
| Mac kapatılıp yeniden açılıyor | Sistem daemon'ı boot sırasında yeniden yüklenir; adaptör sonradan takıldığında otomasyon çalışır |

Gerçek uykudaki Mac USB takılarak mutlaka uyanmaz. Bu davranışa bağımlılık yoktur.
FileVault açılış kilidi, USB aksesuar izni veya eduroam yeniden kimlik doğrulaması
kullanıcı etkileşimi gerektirebilir. İlk aksesuar onayını Mac açık ve kilidi açıkken verin;
tüm aksesuarlara kalıcı izin vermek gerekli değildir.

## Kurulum

macOS ve Xcode Command Line Tools (`xcrun swiftc`) gerektirir. Başka paket veya sürücü yüklemez.

```bash
bash tests/check.sh
bash build.sh
sudo bash install.sh
./ps5-share.sh status
```

İlk kurulum **duraklatılmış** başlar. Eski manuel oturumdan geçişi aşağıdaki gibi
kontrol ettikten sonra otomasyonu etkinleştirin:

```bash
./ps5-share.sh start
```

Kurulum, derlenmiş binary'yi root'a ait
`/Library/PrivilegedHelperTools/local.ps5share/ps5shared` konumuna kopyalar;
root servis çalışma sırasında bu Git klasöründeki dosyaları çalıştırmaz.
Plist `/Library/LaunchDaemons/local.ps5share.plist` konumundadır.
Güncelleme için yeniden build/install çalıştırılabilir; önceki duraklatma tercihi korunur.
Installer eski pipe hatasından dolayı `SIGTERMed` durumda kalmış bilinen daemon komutunu
tam yol ve argümanlarıyla doğrulayıp gerekirse sonlandırır; recovery güncel binary ile yapılır.
Aynı binary, plist ve log yapılandırması zaten çalışan serviste kuruluysa installer hiçbir
dosyayı veya servisi değiştirmeden başarılı çıkar. Gerçek bir güncellemede yeni dosyalar
önce root'a ait staging dizininde doğrulanır. Kurulum/yeniden başlatma başarısız olursa
önceki binary ve yapılandırma geri yüklenip eski servis yeniden başlatılır. Aktif paylaşım
gerçek sürüm güncellemesi sırasında birkaç saniye kesilebilir ve koşullar hâlâ uygunsa
kurulumun ardından otomatik yeniden başlar.

`ps5share`, `ps5stop`, `ps5status` ve `ps5sharelogs` alias'ları bu klasördeki
`ps5-share.sh` komutlarına gidebilir. `ps5sharelogs` canlı log takibini açar. Yeni `stop`, adaptör takılı kalsa da
otomasyonu mevcut boot süresince duraklatır; `start` beklemeden tekrar etkinleştirir.
Shutdown/restart sonrasında duraklatma otomatik kalkar ve servis tekrar adaptör bekler.
Komutlar isteği daemon'a iletir; sonuç için status/log kontrol edilir.

```bash
./ps5-share.sh stop
./ps5-share.sh start
./ps5-share.sh status
./ps5-share.sh logs
```

`logs`, `/var/log/ps5share.log` dosyasının son 100 satırını gösterir ve yeni olayları
canlı takip eder; çıkmak için `Ctrl+C` kullanılır. Örnek olay sırası:

```text
2026-09-20T10:30:00+03:00 STATE adapter=connected(en9) ethernet=up power=AC wifi=ready lid=open automation=enabled
2026-09-20T10:30:00+03:00 SHARING start-trigger reason=all-conditions-ready interface=en9
2026-09-20T10:30:01+03:00 SHARING started interface=en9 client=192.168.2.2 power-policy=AC-only
2026-09-20T10:31:10+03:00 STATE adapter=connected(en9) ethernet=up power=AC wifi=ready lid=closed automation=enabled
2026-09-20T10:35:00+03:00 STATE adapter=disconnected ethernet=down power=AC wifi=ready lid=closed automation=enabled
2026-09-20T10:35:00+03:00 SHARING stop-trigger reason=adapter-removed
2026-09-20T10:35:01+03:00 SHARING stopped settings-restored=true
2026-09-20T10:35:01+03:00 SLEEP requested reason=lid-closed-after-sharing-stop
```

Adaptör, Ethernet, AC ve ağ değişimleri olay bildirimiyle hızlıca görülür. Kapak durumu
10 saniyelik uzlaştırma kontrolünde kaydedildiği için kapatma satırı en geç yaklaşık
10 saniye sonra yazılabilir. Bu timer uyuyan Mac'i uyandırmaz. Log root'a ait `0600`
izinlidir; komut bu yüzden `sudo` isteyebilir. `newsyslog`, dosya 1 MB'ı geçtiğinde
7 sıkıştırılmış geçmiş kopya tutar; daemon her olayda dosyayı yeniden açtığı için
paylaşımı kesmeden yeni dosyaya yazmaya devam eder.

## Eski sürümden geçiş

Eski script, commitlenmemiş güç ayarı notları dahil `legacy/ps5-share.sh.txt`
dosyasında korunmuştur. **Yeni servisle birlikte çalıştırmayın.** Eski sürüm ana PF
ruleset'ini değiştirdiğinden yeni servis Apple'ın `com.apple/*` NAT/filter bağlantılarını
bulamayabilir. Bu durumda hata kaydeder ve paylaşımı başlatmaz; ana ruleset'i kendi başına yüklemez.

Önce mevcut durumu okuyun:

```bash
pmset -g
pmset -g custom
sysctl net.inet.ip.forwarding
sudo pfctl -sr
sudo pfctl -sn
sudo pfctl -s References
```

Eski scriptin `stop` komutu PF'yi sistem genelinde kapattığı için otomatik migration'da
kullanılmaz. Eski `caffeinate` süreci varsa komut satırını doğrulayarak kapatın;
`/tmp` içindeki eski PID dosyasına körü körüne güvenmeyin.

Bu Mac'te eski script öncesi kaydedilmiş AC `sleep` değeri **1**, `SleepDisabled` **0** idi
(2026-09-19 notu). Hâlâ istediğiniz başlangıç ayarları bunlarsa, paylaşım kapalıyken:

```bash
sudo pmset -c sleep 1
sudo pmset disablesleep 0
```

Başka uygulama forwarding kullanmıyorsa eski oturumun `net.inet.ip.forwarding=1`
değeri 0'a döndürülmelidir. Adaptörde eski `192.168.2.1` adresi varsa kaldırılmalıdır.
Yeni daemon, başlangıçta forwarding zaten açıksa veya adaptörde link-local dışında bir
IPv4 varsa devralmayı reddeder. Yeniden başlatma geçici PF/sysctl/arayüz durumunu
temizlemek için bir seçenektir; `pmset` değişiklikleri yeniden başlatmada silinmez.

PF bağlantıları eksikse `/etc/pf.conf` ve kullanılan diğer güvenlik/ağ yazılımları
incelenerek normal ruleset kontrollü biçimde geri yüklenmelidir. Rutin başlangıç veya
durdurma sırasında ana PF ruleset'ini yükleyen bir komut yoktur.

## PS5 ayarları

Kablolu LAN, manuel IPv4:

| Ayar | Değer |
| --- | --- |
| IP | `192.168.2.2` |
| Alt ağ maskesi | `255.255.255.0` |
| Gateway | `192.168.2.1` |
| DNS | `1.1.1.1`, `8.8.8.8` |
| MTU / Proxy | Automatic / Do Not Use |

IPv6 bu paylaşım arayüzünde filtrelenir. Bu işlem NAT ve IPv4 forwarding'dir;
internetten PS5'e port açan `rdr`/port-forwarding kuralları eklenmez.

## Güç ve ağ güvenliği

- Yalnızca `com.apple/ps5share` anchor'ına kural yüklenir. Apple'ın mevcut wildcard
  hook'ları kullanılır; sistem anchor'ları silinmez. Bu ad alanının kullanılabilirliği
  her başlangıçta kontrol edilir ve macOS güncellemelerinden sonra yeniden test edilmelidir.
- PF için `-E` referansı alınır ve yalnızca kendi `-X` token'ı bırakılır; `pfctl -d` yoktur.
  Token çıktısı JSON journal'dan önce ayrı dosyaya yazılır. PF ve dosya sistemi tek
  atomik transaction sunmadığından, tam token üretim anındaki zorla sonlandırmada
  artık bir PF referansı kalması tamamen dışlanamaz. Referansları incelemek için
  `sudo pfctl -s References` kullanılır; tüm PF'yi kapatmak kurtarma yöntemi değildir.
- NAT yalnızca PS5'in `/32` adresine uygulanır. Adaptörden Mac'in kendi IP'lerine
  erişim engellenir. Bu cihaz tanıma, kriptografik kimlik doğrulaması değildir.
- Geçici gateway bir IP alias'ı olarak eklenir; durdururken yalnızca bu alias kaldırılır.
- IPv4 forwarding global bir ayardır. Başlangıçta zaten açıksa servis başlatılmaz;
  bu servis aktifken başka bir paylaşım/router servisi başlatılmamalıdır.
- `sleep`, `displaysleep`, `hibernatemode`, `womp` değiştirilmez. Özellikle `sleep=0`
  kalıcı olarak yazılmaz. Kapak kapalı çalışmak için kullanılan `disablesleep`
  belgelenmemiş ve **sistem genelinde** bir ayardır; AC sınırı daemon tarafından uygulanır.
- Durum root'a ait `0700` izinli `/var/db/ps5share` içinde JSON olarak saklanır;
  shell ile `source` edilmez. Hata durumunda diğer temizleme adımları da denenir ve
  başarısız journal yeniden denemek üzere korunur. Aynı anda ikinci daemon çalışamaz.
- Servis yeniden açılana kadar `SleepDisabled` çökme sonrası kısa süre etkin kalabilir.
  `launchd` yeniden başlatır; başka root yazılımlar veya servis kaldırılması kurtarmayı
  engellerse aşağıdaki recovery komutu gerekir. Sıfır risk/garantili lid desteği iddiası yoktur.
- Kapağı kapalı Mac'i sert, havalanan bir yüzeyde kullanın; çantaya koymadan adaptörü çıkarın.
- Başlatma ve temizliğin ürettiği ağ bildirimleri seri bir kapıdan geçirilir. İşlem sırasında
  gelen birden fazla callback iç içe start/stop çalıştırmaz; bittikten sonra tek yeni
  değerlendirme olarak birleştirilir.

## Gözlem, test ve kaldırma

Sistem ayarlarına dokunmadan olayları görmek için normal kullanıcıyla:

```bash
.build/ps5shared observe
```

USB eklenme/çıkarılma için IOKit, ağ durumu için SystemConfiguration, AC değişimi için
IOPowerSources bildirimleri kullanılır. Normal 10 saniyelik timer yalnızca Mac uyanıkken
çalışır ve kaçırılan olayları/uyanmayı tekrar kontrol eder; RTC wake oluşturmaz.

`bash tests/check.sh` şu kontrolleri çalıştırır:

- Swift derlemesi (uyarılar hata kabul edilir), shell ve plist doğrulaması.
- 32 başlangıç koşulu kombinasyonu, token/arayüz doğrulaması ve JSON round-trip.
- Gerçek sistem komutları çalıştıramayan test binary'sinde start/stop, tekrarlı stop,
  beş başlangıç aşamasına enjekte edilen hata, cleanup hatası/yeniden deneme, kapalı/açık kapakta
  uyku sıralaması, token kaydetme arası çökme, boot kapsamlı manuel duraklatma ve reboot kurtarması.
- Üretilen PF kurallarının `pfctl -nf` ile yüklemeden sözdizimi kontrolü.

Fiziksel kabul testi kurulumdan sonra yapılmalıdır; bu testler otomatik testlerin yerine geçmez:

1. Kapak açık, AC bağlı: tak → internet; çıkar → anchor/IP/uyku durumu eski haline dönmeli.
2. Kilit ekranında tak; eduroam hazırken kilidi açmadan PS5 internetini kontrol et.
3. Mac uyurken tak, kapağı aç; yaklaşık 10 saniye ve ağın geri gelme süresi sonunda bağlanmalı.
4. Aktifken kapağı kapat; PS5 trafiği sürmeli. Adaptörü çıkar; Mac uyumalı.
5. Aktif ve kapak kapalıyken AC gücü çıkar; paylaşım kapanıp Mac uyumalı.
6. Aktif oturumda daemon'ı yeniden başlat; temizlik ve yeniden aktivasyon logunu doğrula.
7. Adaptörsüz yeniden başlat; normal idle/lid sleep davranışını kontrol et.

Kaldırmak için:

```bash
sudo bash uninstall.sh
```

Önce servis durdurulur ve kurtarma çalıştırılır; kurtarma başarısızsa binary/journal silinmez.
Başarılı kaldırmada da log ve durum dizini tanı için korunur. Servis duruyorken elle kurtarma:

```bash
sudo /Library/PrivilegedHelperTools/local.ps5share/ps5shared recover
```

`recover`, çalışan daemon varsa kilit nedeniyle reddedilir. `stop` aktif daemon içindir;
`recover` yalnızca daemon çalışmıyorken yarım kalmış bir oturumu temizlemek içindir.

## Apple kaynakları

- [IOKit cihaz bildirimleri](https://developer.apple.com/documentation/iokit/1514362-ioserviceaddmatchingnotification)
- [SystemConfiguration dynamic store](https://developer.apple.com/documentation/systemconfiguration/scdynamicstore-gb2)
- [USB aksesuar izinleri](https://support.apple.com/en-ca/102282)
- Yerel `man pfctl`, `man pmset`, `man caffeinate`, `man launchd.plist` ve `/etc/pf.conf` açıklamaları.
