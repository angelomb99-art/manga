/* Service worker do Rastreador de Mangás

   Estratégia: "abre da cópia guardada, atualiza em segundo plano".
     1. O app SEMPRE abre da cópia guardada no celular → instantâneo, funciona offline.
     2. Ao mesmo tempo, busca na internet a versão mais nova e guarda pra próxima vez.
     3. Se a página mudou, avisa o app, que mostra "Nova versão pronta — atualizar".

   Só é preciso trocar VERSAO quando a lista de ARQUIVOS mudar (arquivo novo ou removido).
   Mudanças no index.html chegam sozinhas. */
var VERSAO = "mangas-v8";
var ARQUIVOS = ["./index.html", "./manifest.json", "./icon-192.png", "./icon-512.png"];
// "Bilhete" guardado no cache quando chega uma versão nova. A página pergunta por ele ao abrir,
// porque o aviso direto pode chegar antes de a página estar pronta pra ouvir.
var BILHETE = "./__nova-versao__";

self.addEventListener("install", function (e) {
  self.skipWaiting();
  // "reload": busca direto do servidor, ignorando qualquer cópia velha guardada pelo navegador
  e.waitUntil(caches.open(VERSAO).then(function (c) {
    return c.addAll(ARQUIVOS.map(function (a) { return new Request(a, { cache: "reload" }); }));
  }));
});

// Apaga caches de versões antigas e assume o controle das telas abertas.
self.addEventListener("activate", function (e) {
  e.waitUntil(
    caches.keys().then(function (nomes) {
      return Promise.all(nomes.filter(function (n) { return n !== VERSAO; })
                              .map(function (n) { return caches.delete(n); }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener("fetch", function (e) {
  var pedido = e.request;
  if (pedido.method !== "GET" || new URL(pedido.url).origin !== self.location.origin) return;

  // Abrir o app (com ou sem "index.html" no endereço) usa sempre a mesma cópia.
  var ehPagina = pedido.mode === "navigate";
  var endereco = ehPagina ? new URL("index.html", self.registration.scope).href : pedido.url.split("#")[0];

  e.respondWith(caches.open(VERSAO).then(function (cache) {
    // abrir a página entrega a cópia mais nova que temos → o bilhete antigo perde o sentido
    var antes = ehPagina ? cache.delete(new URL(BILHETE, self.registration.scope).href) : Promise.resolve();
    return antes.then(function () { return cache.match(endereco, { ignoreSearch: ehPagina }); }).then(function (guardada) {
      // "no-cache" = pergunta ao servidor se mudou (resposta curtinha quando não mudou)
      var daRede = fetch(endereco, { cache: "no-cache" }).then(function (resposta) {
        if (!resposta || !resposta.ok || resposta.type !== "basic") return resposta;
        var mudou = guardada && versaoMudou(guardada, resposta);
        return cache.put(endereco, resposta.clone()).then(function () {
          if (mudou && ehPagina) deixarBilhete(cache).then(avisarTelas);
          return resposta;
        });
      });

      if (guardada) {
        e.waitUntil(daRede.catch(function () { /* sem internet: tudo bem */ }));
        return guardada;
      }
      return daRede.catch(function () {
        return ehPagina ? cache.match(endereco) : Response.error();
      });
    });
  }));
});

// Compara a "etiqueta de versão" que o servidor manda junto com cada arquivo.
function versaoMudou(antiga, nova) {
  var a = antiga.headers, n = nova.headers;
  if (a.get("etag") && n.get("etag")) return a.get("etag") !== n.get("etag");
  if (a.get("last-modified") && n.get("last-modified")) return a.get("last-modified") !== n.get("last-modified");
  return false;
}

function deixarBilhete(cache) {
  return cache.put(new URL(BILHETE, self.registration.scope).href, new Response("1"));
}

// A página pergunta "tem versão nova?" ao abrir.
self.addEventListener("message", function (e) {
  if (e.data !== "tem-versao-nova?" || !e.source) return;
  e.waitUntil(caches.open(VERSAO).then(function (cache) {
    return cache.match(new URL(BILHETE, self.registration.scope).href);
  }).then(function (bilhete) {
    if (bilhete) e.source.postMessage("nova-versao");
  }));
});

function avisarTelas() {
  self.clients.matchAll({ type: "window" }).then(function (telas) {
    telas.forEach(function (t) { t.postMessage("nova-versao"); });
  });
}
