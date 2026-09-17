package io.github.gregorgregor25.t1arc.watchinstaller

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import org.bouncycastle.asn1.x500.X500Name
import org.bouncycastle.cert.jcajce.JcaX509v3CertificateBuilder
import org.bouncycastle.operator.jcajce.JcaContentSignerBuilder
import java.io.File
import java.math.BigInteger
import java.security.KeyFactory
import java.security.KeyPairGenerator
import java.security.KeyStore
import java.security.PrivateKey
import java.security.cert.Certificate
import java.security.cert.CertificateFactory
import java.security.spec.PKCS8EncodedKeySpec
import java.util.Date
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec
import org.json.JSONObject
import android.util.Base64

/** ADB needs an exportable RSA key; encrypt it with a non-exportable Keystore key. */
internal class InstallerIdentity(context: Context) {
    val key: PrivateKey
    val certificate: Certificate

    init {
        val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        val alias = "t1arc.watch-installer.wrap.v1"
        if (!store.containsAlias(alias)) {
            KeyGenerator.getInstance("AES", "AndroidKeyStore").apply {
                init(KeyGenParameterSpec.Builder(alias, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                    .setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).build())
            }.generateKey()
        }
        val wrappingKey = store.getKey(alias, null) as SecretKey
        val file = File(context.noBackupFilesDir, "watch-installer-identity.v1")
        val decode: (String) -> ByteArray = { Base64.decode(it, Base64.NO_WRAP) }
        val identity: JSONObject
        if (file.exists()) {
            val bytes = file.readBytes()
            val cipher = Cipher.getInstance("AES/GCM/NoPadding")
            cipher.init(Cipher.DECRYPT_MODE, wrappingKey, GCMParameterSpec(128, bytes.copyOfRange(0, 12)))
            identity = JSONObject(String(cipher.doFinal(bytes.copyOfRange(12, bytes.size)), Charsets.UTF_8))
        } else {
            val pair = KeyPairGenerator.getInstance("RSA").apply { initialize(2048) }.generateKeyPair()
            val name = X500Name("CN=T1 Arc watch setup")
            val cert = JcaX509v3CertificateBuilder(name, BigInteger.valueOf(System.currentTimeMillis()),
                Date(System.currentTimeMillis() - 86_400_000), Date(System.currentTimeMillis() + 10L * 365 * 86_400_000),
                name, pair.public).build(JcaContentSignerBuilder("SHA256withRSA").build(pair.private))
            identity = JSONObject().put("key", Base64.encodeToString(pair.private.encoded, Base64.NO_WRAP))
                .put("certificate", Base64.encodeToString(cert.encoded, Base64.NO_WRAP))
            val cipher = Cipher.getInstance("AES/GCM/NoPadding")
            cipher.init(Cipher.ENCRYPT_MODE, wrappingKey)
            val encrypted = cipher.doFinal(identity.toString().toByteArray(Charsets.UTF_8))
            val temporary = File(file.parentFile, file.name + ".tmp")
            temporary.writeBytes(cipher.iv + encrypted)
            check(temporary.renameTo(file)) { "Could not save watch pairing identity." }
        }
        key = KeyFactory.getInstance("RSA").generatePrivate(PKCS8EncodedKeySpec(decode(identity.getString("key"))))
        certificate = CertificateFactory.getInstance("X.509").generateCertificate(decode(identity.getString("certificate")).inputStream())
    }
}
