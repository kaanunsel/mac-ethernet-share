# PS5 Eduroam Internet Sharing Script

Bu klasördeki `ps5-share.sh` scripti, MacBook'un Eduroam üzerinden aldığı interneti USB-C Ethernet adaptörü ile PlayStation 5'e paylaşmak için kullanılır.

## Problem

PS5, Eduroam ağına doğrudan bağlanamıyor çünkü Eduroam genellikle `802.1X / WPA Enterprise` kimlik doğrulaması kullanıyor.

Normalde macOS üzerinde:  
System Settings → General → Sharing → Internet Sharing  
ile Wi-Fi internetini Ethernet üzerinden paylaşmak mümkün. Ancak Eduroam gibi 802.1X ile korunan ağlarda macOS şu hatayı veriyor:

```text
Your Internet connection cannot be shared because it is protected by 802.1X.
Choose a different network to share or disable Internet Sharing.
```

Windows tarafında Internet Connection Sharing bu senaryoda çalışabiliyor, ancak macOS Internet Sharing bunu güvenlik nedeniyle engelliyor.

Bu yüzden macOS'un grafik arayüzündeki Internet Sharing özelliğini kullanmak yerine manuel olarak:

- IP forwarding
- PF NAT rule
- Ethernet interface IP assignment

ile aynı işi kendimiz yapıyoruz.

## Ağ Topolojisi

Eduroam Wi-Fi  
     ↓  
MacBook Wi-Fi interface: en0  
     ↓  
macOS IP forwarding + PF NAT  
     ↓  
USB-C Ethernet adapter: en9  
     ↓  
Ethernet cable  
     ↓  
PlayStation 5

## Bu Mac'teki Interface Bilgileri

Bu kurulum sırasında interface'ler şu şekilde tespit edildi:

Wi-Fi / Eduroam tarafı: en0  
USB-C Ethernet adaptörü / PS5 tarafı: en9

Ethernet adaptörü AX88179B olarak görünüyor.

Kontrol etmek için:

```bash
networksetup -listallhardwareports
```

## Script Ne Yapıyor?

`ps5-share.sh start` çalıştırıldığında script şu işlemleri yapar:

1. IPv4 forwarding açar:

```bash
sudo sysctl -w net.inet.ip.forwarding=1
```

2. PS5'e giden Ethernet adaptörüne gateway IP verir:

```bash
sudo ifconfig en9 inet 192.168.2.1 netmask 255.255.255.0 up
```

3. Geçici PF NAT config dosyası oluşturur:

`/tmp/ps5share.conf`

4. NAT kuralını yükler:

```text
nat on en0 from 192.168.2.0/24 to any -> (en0)
```

Bu kural şu anlama gelir:

192.168.2.0/24 ağından gelen trafiği en0 üzerinden internete çıkar.

5. PF filter kuralları ile en9 ve en0 üzerinden trafiğe izin verir.  
6. PF'yi aktif eder.  
7. Şarjdayken Mac'i uyanık tutar (kapak kapalı dahil), böylece NAT sleep yüzünden kesilmez.

## Kullanım

Paylaşımı başlatmak için:

```bash
./ps5-share.sh start
```

Durdurmak için:

```bash
./ps5-share.sh stop
```

Durumu görmek için:

```bash
./ps5-share.sh status
```

Alias tanımlandıysa:

```text
ps5share
ps5stop
ps5status
```

## PS5 Manuel Ağ Ayarları

PS5 tarafında kablolu LAN ayarı manuel yapılmalı.

PS5 menüsünde:

Settings  
→ Network  
→ Set Up Internet Connection  
→ Set Up Wired LAN  
→ Custom / Manual

Değerler:

```text
IPv4 Address / IP Adresi:        192.168.2.2
Subnet Mask / Alt Ağ Maskesi:    255.255.255.0
Default Gateway / Ağ Geçidi:     192.168.2.1
Primary DNS / Birincil DNS:      1.1.1.1
Secondary DNS / İkincil DNS:     8.8.8.8
MTU:                             Automatic
Proxy Server:                    Do Not Use
DHCP Hostname:                   Do Not Specify
```

## Doğrulama Komutları

NAT kuralı yüklendi mi?

```bash
sudo pfctl -sn
```

Beklenen çıktı:

```text
nat on en0 inet from 192.168.2.0/24 to any -> (en0)
```

Filter kuralları yüklendi mi?

```bash
sudo pfctl -sr
```

Beklenen çıktı:

```text
pass quick on en9 all flags S/SA keep state
pass quick on en0 all flags S/SA keep state
```

Ethernet adaptörü doğru IP aldı mı?

```bash
ifconfig en9 | grep inet
```

Beklenen çıktı:

```text
inet 192.168.2.1 netmask 0xffffff00 broadcast 192.168.2.255
```

IP forwarding açık mı?

```bash
sysctl net.inet.ip.forwarding
```

Beklenen çıktı:

```text
net.inet.ip.forwarding: 1
```

## Debug

PS5 IP alıyor ama internete çıkamıyorsa Mac'te şu komutla PS5'ten paket gelip gelmediği kontrol edilebilir:

```bash
sudo tcpdump -ni en9
```

Bu komut açıkken PS5'te tekrar internet testi yapılır.

Eğer terminalde paketler görünüyorsa:

PS5 → MacBook bağlantısı çalışıyor.

Bu durumda sorun NAT, DNS veya Eduroam çıkış tarafında olabilir.

Eğer terminalde hiç paket görünmüyorsa:

PS5 → MacBook Ethernet bağlantısı çalışmıyor.

Bu durumda kablo, adaptör, PS5 Ethernet portu veya PS5 manuel IP ayarları kontrol edilmeli.

## Geri Alma

Paylaşımı durdurmak için:

```bash
./ps5-share.sh stop
```

Manuel geri alma gerekirse:

```bash
sudo pfctl -d
sudo sysctl -w net.inet.ip.forwarding=0
sudo rm -f /tmp/ps5share.conf
```

Gerekirse Ethernet interface kapatılabilir:

```bash
sudo ifconfig en9 down
```

## Kapak Kapalı / Şarjdayken Çalışması

Mac gerçekten sleep'e girerse paket iletmez. NAT, Wi-Fi ve USB Ethernet o anda durur. Bu yüzden "uyurken paylaşım" mümkün değil; şarjdayken Mac'in uyanık kalması gerekir.

`./ps5-share.sh start` bunu otomatik yapar:

- Şarjdayken idle sleep kapatılır (`pmset -c sleep 0`)
- Kapak kapatılınca da sleep engellenir (`pmset -c disablesleep 1`)
- Ekran uykusu aynı kalır; ekran kararabilir
- `caffeinate` idle sleep'e karşı ek koruma tutar

Kapak kapatılabilir, adaptör takılı kalmalıdır. `stop` eski sleep ayarlarını geri yükler.

Isınma için Mac'in havalanmasına izin verin; yastık veya yatak üzerinde kapalı kapakla uzun süre çalıştırmayın.

## Kalıcılık Notu

Bu kurulum kalıcı değildir.

Mac restart edilirse veya PF kapatılırsa tekrar başlatmak gerekir:

```bash
./ps5-share.sh start
```

Bu bilinçli olarak böyle bırakıldı çünkü sistemin kalıcı `/etc/pf.conf` dosyası değiştirilmedi. Böylece Mac'in firewall ve network ayarlarını kalıcı olarak bozma riski azaltıldı.

## Dikkat Edilecek Noktalar

- Bu script macOS Internet Sharing arayüzünü kullanmaz.
- Eduroam'un 802.1X kısıtını macOS UI üzerinden değil, manuel NAT ile bypass eder.
- Script `/etc/pf.conf` dosyasını değiştirmez.
- Geçici config dosyası `/tmp/ps5share.conf` kullanılır.
- Başka Ethernet adaptörü takılırsa interface ismi en9 yerine farklı olabilir.
- Interface değişirse script içindeki şu satır güncellenmelidir:

```bash
PS5_IF="en9"
```

Yeni interface adını bulmak için:

```bash
networksetup -listallhardwareports
```

## Özet

Bu çözüm sayesinde MacBook, Eduroam'a Wi-Fi üzerinden bağlıyken PS5'e Ethernet üzerinden internet verebilir.

macOS'un normal Internet Sharing özelliği Eduroam için 802.1X nedeniyle çalışmadığından, çözüm manuel olarak:

IP forwarding + PF NAT + manuel PS5 IP ayarı

şeklinde kurulmuştur.
