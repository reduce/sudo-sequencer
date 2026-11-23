// ---------- saving files ----------
// A tiny save API, save({filename,data}), that writes the bytes as a Blob download. The MIDI zips,
// the WAV recordings and the loop exports all go through it (as the promise DLP).
(function(){
  'use strict';
  const MIME={zip:'application/zip',mid:'audio/midi',json:'application/json',txt:'text/plain'};

  function mimeFor(name){
    const ext=(/\.([a-z0-9]+)$/i.exec(name)||[])[1];
    return (ext&&MIME[ext.toLowerCase()])||'application/octet-stream';
  }

  async function save({filename,data}){
    const blob=new Blob([data],{type:mimeFor(filename)});
    const url=URL.createObjectURL(blob);
    const a=document.createElement('a');
    a.href=url;a.download=filename;a.rel='noopener';
    document.body.append(a);
    a.click();
    a.remove();
    // Safari needs the object URL to outlive the click
    setTimeout(()=>URL.revokeObjectURL(url),20000);
  }

  // Anything that is not a declined prompt is a real failure, as far as the views are concerned.
  window.DLP=Promise.resolve({save});
})();
