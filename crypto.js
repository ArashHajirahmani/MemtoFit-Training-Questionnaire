/* Plan ciphertext: base64(salt 16 || iv 12 || AES-GCM bytes).
   Key: PBKDF2 SHA-256, 100000 rounds, password is the normalized name. */
(function (root) {
  var ITERATIONS = 100000;

  function bytesToBase64(bytes) {
    var bin = "";
    var arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    for (var i = 0; i < arr.length; i++) bin += String.fromCharCode(arr[i]);
    return btoa(bin);
  }

  function base64ToBytes(str) {
    var bin = atob(str);
    var arr = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    return arr;
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

  function encryptPlan(password, html) {
    var salt = crypto.getRandomValues(new Uint8Array(16));
    var iv = crypto.getRandomValues(new Uint8Array(12));
    return deriveKey(password, salt, ["encrypt"]).then(function (key) {
      return crypto.subtle.encrypt(
        { name: "AES-GCM", iv: iv },
        key,
        new TextEncoder().encode(html)
      ).then(function (cipher) {
        var c = new Uint8Array(cipher);
        var out = new Uint8Array(salt.length + iv.length + c.length);
        out.set(salt, 0);
        out.set(iv, salt.length);
        out.set(c, salt.length + iv.length);
        return bytesToBase64(out);
      });
    });
  }

  function decryptPlan(password, packed) {
    var raw = base64ToBytes(packed);
    var salt = raw.slice(0, 16);
    var iv = raw.slice(16, 28);
    var cipher = raw.slice(28);
    return deriveKey(password, salt, ["decrypt"]).then(function (key) {
      return crypto.subtle.decrypt({ name: "AES-GCM", iv: iv }, key, cipher);
    }).then(function (buf) {
      return new TextDecoder().decode(buf);
    });
  }

  root.memtofitCrypto = {
    encryptPlan: encryptPlan,
    decryptPlan: decryptPlan
  };
})(typeof window !== "undefined" ? window : globalThis);
