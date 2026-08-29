use aes_gcm::aead::{Aead, KeyInit, Payload};
use aes_gcm::{Aes256Gcm, Nonce};
use rand::rngs::OsRng;
use rand::RngCore;

pub const MAGIC: &[u8] = b"SKUF1";
pub const VERSION: u8 = 1;
pub const KEY_LEN: usize = 32;
pub const NONCE_LEN: usize = 12;
pub const TAG_LEN: usize = 16;

pub fn normalize_path(rel: &str) -> String {
    rel.replace('\\', "/").trim_start_matches('/').to_string()
}

pub fn generate_key() -> [u8; KEY_LEN] {
    let mut key = [0u8; KEY_LEN];
    OsRng.fill_bytes(&mut key);
    key
}

pub fn encode_key(key: &[u8; KEY_LEN]) -> String {
    use base64::{engine::general_purpose::STANDARD, Engine as _};
    STANDARD.encode(key)
}

pub fn decode_key(value: &str) -> Result<[u8; KEY_LEN], String> {
    use base64::{engine::general_purpose::STANDARD, Engine as _};
    let bytes = STANDARD
        .decode(value.trim())
        .map_err(|e| format!("Invalid vault key: {e}"))?;
    if bytes.len() != KEY_LEN {
        return Err(format!("Vault key must be {KEY_LEN} bytes (base64-encoded)"));
    }
    let mut key = [0u8; KEY_LEN];
    key.copy_from_slice(&bytes);
    Ok(key)
}

pub fn is_encrypted(bytes: &[u8]) -> bool {
    bytes.len() >= MAGIC.len() + 1 + NONCE_LEN + TAG_LEN && bytes.starts_with(MAGIC)
}

pub fn encrypt(key: &[u8; KEY_LEN], rel_path: &str, plaintext: &[u8]) -> Result<Vec<u8>, String> {
    let mut nonce_bytes = [0u8; NONCE_LEN];
    OsRng.fill_bytes(&mut nonce_bytes);
    encrypt_with_nonce(key, rel_path, plaintext, &nonce_bytes)
}

pub fn encrypt_with_nonce(
    key: &[u8; KEY_LEN],
    rel_path: &str,
    plaintext: &[u8],
    nonce_bytes: &[u8; NONCE_LEN],
) -> Result<Vec<u8>, String> {
    let cipher = Aes256Gcm::new_from_slice(key).map_err(|e| e.to_string())?;
    let nonce = Nonce::from_slice(nonce_bytes);
    let aad = normalize_path(rel_path).into_bytes();
    let ct = cipher
        .encrypt(nonce, Payload { msg: plaintext, aad: &aad })
        .map_err(|e| e.to_string())?;
    let mut out = Vec::with_capacity(MAGIC.len() + 1 + NONCE_LEN + ct.len());
    out.extend_from_slice(MAGIC);
    out.push(VERSION);
    out.extend_from_slice(nonce_bytes);
    out.extend_from_slice(&ct);
    Ok(out)
}

pub fn decrypt(key: &[u8; KEY_LEN], rel_path: &str, sealed: &[u8]) -> Result<Vec<u8>, String> {
    if !is_encrypted(sealed) {
        return Err(format!("File {rel_path} is not a Skuffen vault object"));
    }
    let version = sealed[MAGIC.len()];
    if version != VERSION {
        return Err(format!("Unsupported vault version {version}"));
    }
    let nonce_start = MAGIC.len() + 1;
    let nonce_end = nonce_start + NONCE_LEN;
    if sealed.len() < nonce_end + TAG_LEN {
        return Err(format!("File {rel_path} is truncated"));
    }
    let nonce = Nonce::from_slice(&sealed[nonce_start..nonce_end]);
    let ct = &sealed[nonce_end..];
    let cipher = Aes256Gcm::new_from_slice(key).map_err(|e| e.to_string())?;
    let aad = normalize_path(rel_path).into_bytes();
    cipher
        .decrypt(nonce, Payload { msg: ct, aad: &aad })
        .map_err(|_| format!("Could not decrypt {rel_path}. Wrong key, or the file was moved."))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn round_trip_and_aad() {
        let key = generate_key();
        let path = "people/ada-lovelace/person.md";
        let plain = b"---\ntype: Person\ntitle: Ada Lovelace\n---\n";
        let sealed = encrypt(&key, path, plain).unwrap();
        assert!(is_encrypted(&sealed));
        assert!(!String::from_utf8_lossy(&sealed).contains("Ada Lovelace"));
        assert_eq!(decrypt(&key, path, &sealed).unwrap(), plain);
        assert!(decrypt(&key, "people/other/person.md", &sealed).is_err());
        let other = generate_key();
        assert!(decrypt(&other, path, &sealed).is_err());
    }

    #[test]
    fn known_vector_matches_node() {
        let key = [0x11u8; 32];
        let nonce = [0x22u8; 12];
        let path = "people/ada-lovelace/person.md";
        let sealed = encrypt_with_nonce(&key, path, b"hello-okf", &nonce).unwrap();
        let hex: String = sealed.iter().map(|b| format!("{b:02x}")).collect();
        assert_eq!(
            hex,
            "534b554631012222222222222222222222227f926b25afe2f0348330e625b791e5c2a953a861ff200aafef"
        );
        assert_eq!(decrypt(&key, path, &sealed).unwrap(), b"hello-okf");
    }
}
