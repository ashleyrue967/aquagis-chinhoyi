var C='aquagis-v4',F=['./','./index.html','./manifest.json','./icon.svg','./icon-192.png','./icon-512.png'];
self.addEventListener('install',function(e){e.waitUntil(caches.open(C).then(function(c){return c.addAll(F)}));self.skipWaiting()});
self.addEventListener('activate',function(e){e.waitUntil(caches.keys().then(function(k){return Promise.all(k.filter(function(x){return x!==C}).map(function(x){return caches.delete(x)}))}));self.clients.claim()});
self.addEventListener('fetch',function(e){
 if(e.request.method!=='GET')return;
 var u=new URL(e.request.url);
 /* never cache or intercept API calls: they carry private data */
 if(u.pathname.indexOf('/api/')===0||u.origin!==location.origin)return;
 e.respondWith(fetch(e.request).then(function(r){var c=r.clone();caches.open(C).then(function(h){h.put(e.request,c)});return r}).catch(function(){return caches.match(e.request)}))});
