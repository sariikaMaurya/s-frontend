(() => {
    const button = document.getElementById('menu');
    const navigation = document.querySelector('.navbar');
    if (!button || !navigation) return;

    function setOpen(open) {
        navigation.classList.toggle('nav-toggle', open);
        button.classList.toggle('fa-times', open);
        button.setAttribute('aria-expanded', String(open));
        button.setAttribute('aria-label', open ? 'Close navigation' : 'Open navigation');
    }

    button.setAttribute('aria-expanded', 'false');
    button.addEventListener('click', () => setOpen(button.getAttribute('aria-expanded') !== 'true'));
    navigation.addEventListener('click', (event) => {
        if (event.target.closest('a')) setOpen(false);
    });
    document.addEventListener('click', (event) => {
        if (!navigation.contains(event.target) && !button.contains(event.target)) setOpen(false);
    });
    window.matchMedia('(max-width: 768px)').addEventListener('change', () => setOpen(false));
})();

// Shared one-time timeline entrances are managed by portfolio-motion.js.


// disable developer mode
document.onkeydown = function(e) {
  if(e.keyCode == 123) {
     return false;
  }
  if(e.ctrlKey && e.shiftKey && e.keyCode == 'I'.charCodeAt(0)) {
     return false;
  }
  if(e.ctrlKey && e.shiftKey && e.keyCode == 'C'.charCodeAt(0)) {
     return false;
  }
  if(e.ctrlKey && e.shiftKey && e.keyCode == 'J'.charCodeAt(0)) {
     return false;
  }
  if(e.ctrlKey && e.keyCode == 'U'.charCodeAt(0)) {
     return false;
  }
}

document.addEventListener('visibilitychange',
function(){
    if(document.visibilityState === "visible"){
        document.title = "Experience | Portfolio Shalu Verma";
        $("#favicon").attr("href","../assets/images/favicon.png");
    }
    else {
        document.title = "Come Back To Portfolio";
        $("#favicon").attr("href","../assets/images/favhand.png");
    }
});
