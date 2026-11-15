/* Plan/photo ciphertext: base64(salt 16 || iv 12 || AES-GCM bytes).
   Key: PBKDF2 SHA-256, 100000 rounds, password is the normalized name. */
(function (root) {
  var ITERATIONS = 100000;

  function base64ToBytes(str) {
    var bin = atob(str);
    var arr = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    return arr;
  }

  function bytesToBase64(bytes) {
    var bin = "";
    var arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    for (var i = 0; i < arr.length; i++) bin += String.fromCharCode(arr[i]);
    return btoa(bin);
  }

  function deriveKey(password, salt, usages) {
    return crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(password),
      "PBKDF2",
      false,
      ["deriveKey"]
    ).then(function (base) {
      return crypto.subtle.deriveKey(
        { name: "PBKDF2", salt: salt, iterations: ITERATIONS, hash: "SHA-256" },
        base,
        { name: "AES-GCM", length: 256 },
        false,
        usages
      );
    });
  }

  function packCipher(salt, iv, cipherBuf) {
    var cipher = new Uint8Array(cipherBuf);
    var out = new Uint8Array(16 + 12 + cipher.length);
    out.set(salt, 0);
    out.set(iv, 16);
    out.set(cipher, 28);
    return bytesToBase64(out);
  }

  function unpackCipher(packed) {
    var raw = base64ToBytes(packed);
    return {
      salt: raw.slice(0, 16),
      iv: raw.slice(16, 28),
      cipher: raw.slice(28)
    };
  }

  function decryptPlan(password, packed) {
    var parts = unpackCipher(packed);
    return deriveKey(password, parts.salt, ["decrypt"]).then(function (key) {
      return crypto.subtle.decrypt({ name: "AES-GCM", iv: parts.iv }, key, parts.cipher);
    }).then(function (buf) {
      return new TextDecoder().decode(buf);
    });
  }

  function encryptBytes(password, bytes) {
    var salt = crypto.getRandomValues(new Uint8Array(16));
    var iv = crypto.getRandomValues(new Uint8Array(12));
    var plain = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    return deriveKey(password, salt, ["encrypt"]).then(function (key) {
      return crypto.subtle.encrypt({ name: "AES-GCM", iv: iv }, key, plain);
    }).then(function (cipherBuf) {
      return packCipher(salt, iv, cipherBuf);
    });
  }

  function decryptBytes(password, packed) {
    var parts = unpackCipher(packed);
    return deriveKey(password, parts.salt, ["decrypt"]).then(function (key) {
      return crypto.subtle.decrypt({ name: "AES-GCM", iv: parts.iv }, key, parts.cipher);
    }).then(function (buf) {
      return new Uint8Array(buf);
    });
  }

  function encryptBlob(password, blob) {
    return blob.arrayBuffer().then(function (buf) {
      return encryptBytes(password, new Uint8Array(buf));
    });
  }

  function decryptBlob(password, packed, mime) {
    return decryptBytes(password, packed).then(function (bytes) {
      return new Blob([bytes], { type: mime || "image/jpeg" });
    });
  }

  root.memtofitCrypto = {
    decryptPlan: decryptPlan,
    encryptBytes: encryptBytes,
    decryptBytes: decryptBytes,
    encryptBlob: encryptBlob,
    decryptBlob: decryptBlob
  };
})(typeof window !== "undefined" ? window : globalThis);
