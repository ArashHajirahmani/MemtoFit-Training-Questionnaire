/* Plan ciphertext: base64(salt 16 || iv 12 || AES-GCM bytes).
   Key: PBKDF2 SHA-256, 100000 rounds, password is the normalized name. */
(function (root) {
  var ITERATIONS = 100000;

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
    decryptPlan: decryptPlan
  };
})(typeof window !== "undefined" ? window : globalThis);
