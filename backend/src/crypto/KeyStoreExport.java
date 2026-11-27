import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.security.KeyFactory;
import java.security.KeyStore;
import java.security.PrivateKey;
import java.security.cert.Certificate;
import java.security.cert.CertificateFactory;
import java.security.cert.X509Certificate;
import java.security.spec.PKCS8EncodedKeySpec;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Base64;
import java.util.List;

/**
 * Writes a PKCS#12 or JKS key store with the standard Java KeyStore API (no own crypto).
 * Called by backend/src/crypto/pkcs12.ts; it replaces the openssl CLI.
 *
 * argv: {@code <PKCS12|JKS> <modern|legacy>}
 * stdin (lines, each one Base64): store password (UTF-8), key password (UTF-8), alias (UTF-8),
 * PKCS#8 DER private key (an empty line for a trust store); then the PEM certificates: the leaf
 * (or the trusted certificate) first, then its chain.
 * stdout: the key store bytes.
 *
 * Secrets come on stdin, so they are never in argv or the environment, and they are decoded as
 * UTF-8 whatever the locale of the JVM is.
 */
public final class KeyStoreExport {
  private KeyStoreExport() {}

  /** Fixed PKCS#12 profiles, so a java.security file cannot change them. */
  private static void setPkcs12Profile(String profile) {
    final String pbe;
    final String mac;
    final String iterations;
    if ("modern".equals(profile)) {
      // Same algorithms as the OpenSSL 3 default: PBES2 AES-256-CBC + PBKDF2-HMAC-SHA256, SHA-256 MAC.
      pbe = "PBEWithHmacSHA256AndAES_256";
      mac = "HmacPBESHA256";
      iterations = "10000";
    } else if ("legacy".equals(profile)) {
      // Same as `openssl pkcs12 -legacy -keypbe PBE-SHA1-3DES -certpbe PBE-SHA1-3DES -macalg sha1`.
      pbe = "PBEWithSHA1AndDESede";
      mac = "HmacPBESHA1";
      iterations = "2048";
    } else {
      throw new IllegalArgumentException("unknown profile: " + profile);
    }
    System.setProperty("keystore.pkcs12.certProtectionAlgorithm", pbe);
    System.setProperty("keystore.pkcs12.keyProtectionAlgorithm", pbe);
    System.setProperty("keystore.pkcs12.macAlgorithm", mac);
    System.setProperty("keystore.pkcs12.certPbeIterationCount", iterations);
    System.setProperty("keystore.pkcs12.keyPbeIterationCount", iterations);
    System.setProperty("keystore.pkcs12.macIterationCount", iterations);
  }

  private static String readLine(InputStream in) throws IOException {
    ByteArrayOutputStream line = new ByteArrayOutputStream();
    int b;
    while ((b = in.read()) != -1 && b != '\n') {
      if (b != '\r') line.write(b);
    }
    if (b == -1) throw new IOException("unexpected end of input");
    return line.toString(StandardCharsets.US_ASCII);
  }

  private static byte[] b64(String s) {
    return Base64.getDecoder().decode(s);
  }

  /** Leaf first, then each issuer; drops duplicates. A certificate that does not fit is an error. */
  private static List<X509Certificate> orderChain(List<X509Certificate> certs) {
    List<X509Certificate> rest = new ArrayList<>();
    for (X509Certificate c : certs.subList(1, certs.size())) {
      boolean dup = c.equals(certs.get(0));
      for (X509Certificate r : rest) dup |= c.equals(r);
      if (!dup) rest.add(c);
    }
    List<X509Certificate> chain = new ArrayList<>(List.of(certs.get(0)));
    while (!rest.isEmpty()) {
      X509Certificate last = chain.get(chain.size() - 1);
      if (last.getIssuerX500Principal().equals(last.getSubjectX500Principal())) break;
      X509Certificate next = null;
      for (X509Certificate r : rest) {
        if (r.getSubjectX500Principal().equals(last.getIssuerX500Principal())) next = r;
      }
      if (next == null) break;
      chain.add(next);
      rest.remove(next);
    }
    if (!rest.isEmpty()) {
      throw new IllegalArgumentException("a chain certificate is not an issuer of the leaf certificate");
    }
    return chain;
  }

  public static void main(String[] args) throws Exception {
    if (args.length != 2) throw new IllegalArgumentException("usage: KeyStoreExport <PKCS12|JKS> <modern|legacy>");
    String type = args[0];
    if (!type.equals("PKCS12") && !type.equals("JKS")) throw new IllegalArgumentException("unknown type: " + type);
    if (type.equals("PKCS12")) setPkcs12Profile(args[1]);

    InputStream in = System.in;
    char[] password = new String(b64(readLine(in)), StandardCharsets.UTF_8).toCharArray();
    char[] keyPassword = new String(b64(readLine(in)), StandardCharsets.UTF_8).toCharArray();
    String alias = new String(b64(readLine(in)), StandardCharsets.UTF_8);
    byte[] keyDer = b64(readLine(in));
    byte[] pems = in.readAllBytes();

    List<X509Certificate> certs = new ArrayList<>();
    for (Certificate c : CertificateFactory.getInstance("X.509").generateCertificates(new ByteArrayInputStream(pems))) {
      certs.add((X509Certificate) c);
    }
    if (certs.isEmpty()) throw new IllegalArgumentException("no certificate");
    if (alias.isEmpty()) throw new IllegalArgumentException("empty alias");

    KeyStore ks = KeyStore.getInstance(type);
    ks.load(null, null);
    if (keyDer.length > 0) {
      X509Certificate leaf = certs.get(0);
      String algorithm = leaf.getPublicKey().getAlgorithm();
      PrivateKey key = KeyFactory.getInstance(algorithm).generatePrivate(new PKCS8EncodedKeySpec(keyDer));
      Arrays.fill(keyDer, (byte) 0);
      ks.setKeyEntry(alias, key, keyPassword, orderChain(certs).toArray(new Certificate[0]));
    } else {
      for (int i = 0; i < certs.size(); i++) {
        ks.setCertificateEntry(i == 0 ? alias : alias + "-" + (i + 1), certs.get(i));
      }
    }
    ByteArrayOutputStream out = new ByteArrayOutputStream();
    ks.store(out, password);
    Arrays.fill(password, '\0');
    Arrays.fill(keyPassword, '\0');
    System.out.write(out.toByteArray());
    System.out.flush();
  }
}
