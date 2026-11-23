// ---------- ticker ----------
// Both views schedule their audio from a timer that runs every 25 ms. A browser throttles
// main-thread timers in a hidden tab to about one call a second, which would starve that
// scheduler between calls. Timers inside a dedicated worker are throttled far less, so the
// scheduler keeps its lookahead filled while the tab is in the background.
//
// makeTicker() returns {start(ms, fn), stop()}. If workers are unavailable (or blocked by the
// page's policies, for example on file:// in some browsers) it falls back to setInterval and
// everything still works, just with more jitter in the background.
(function(){
  'use strict';
  const SRC='let id=null;onmessage=e=>{clearInterval(id);id=null;'+
            'if(e.data&&e.data.ms>0)id=setInterval(()=>postMessage(0),e.data.ms)};';

  function supported(){
    try{
      return typeof Worker==='function'&&typeof Blob==='function'&&
             typeof URL!=='undefined'&&typeof URL.createObjectURL==='function';
    }catch(e){return false}
  }

  function makeTicker(){
    let worker=null,url=null,fallback=null,fn=null,ms=25;

    function arm(){
      fallback=setInterval(()=>{if(fn)fn()},ms);
    }

    function stop(){
      if(worker){try{worker.postMessage({ms:0})}catch(e){}}
      if(fallback){clearInterval(fallback);fallback=null}
    }

    function start(interval,onTick){
      stop();
      fn=onTick;ms=interval;
      if(supported()){
        try{
          if(!worker){
            url=url||URL.createObjectURL(new Blob([SRC],{type:'text/javascript'}));
            worker=new Worker(url);
            worker.onmessage=()=>{if(fn)fn()};
            worker.onerror=()=>{worker=null;if(fn)arm()};
          }
          worker.postMessage({ms:interval});
          return;
        }catch(e){worker=null}
      }
      arm();
    }

    return{start,stop};
  }

  // One factory for both views: each calls makeTicker() and owns its ticker.
  window.makeTicker=makeTicker;
})();
