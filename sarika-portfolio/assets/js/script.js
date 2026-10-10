document.addEventListener('DOMContentLoaded', function () {
    const menuButton = document.getElementById('menu');
    const navbar = document.querySelector('.navbar');
    const scrollTopButton = document.querySelector('#scroll-top');

    const closeNavbar = () => {
        if (!menuButton || !navbar) return;
        menuButton.classList.remove('fa-times');
        navbar.classList.remove('nav-toggle');
        menuButton.setAttribute('aria-expanded', 'false');
    };

    const updateActiveSection = () => {
        const sections = document.querySelectorAll('section[id]');
        const navLinks = document.querySelectorAll('.navbar ul li a');
        let currentSectionId = 'home';

        sections.forEach((section) => {
            const sectionTop = section.offsetTop - 200;
            const sectionHeight = section.offsetHeight;
            if (window.scrollY >= sectionTop && window.scrollY < sectionTop + sectionHeight) {
                currentSectionId = section.id;
            }
        });

        navLinks.forEach((link) => {
            const isCurrent = link.getAttribute('href') === `#${currentSectionId}`;
            link.classList.toggle('active', isCurrent);
            if (isCurrent) {
                link.setAttribute('aria-current', 'page');
            } else {
                link.removeAttribute('aria-current');
            }
        });
    };

    const handlePageScroll = () => {
        if (scrollTopButton) {
            if (window.scrollY > 60) {
                scrollTopButton.classList.add('active');
            } else {
                scrollTopButton.classList.remove('active');
            }
        }

        updateActiveSection();
    };

    window.addEventListener('scroll', handlePageScroll, { passive: true });
    window.addEventListener('load', handlePageScroll);

    document.querySelectorAll('a[href^="#"]').forEach((link) => {
        link.addEventListener('click', function (event) {
            const targetId = this.getAttribute('href');
            if (!targetId || targetId === '#') return;
            const targetElement = document.querySelector(targetId);
            if (!targetElement) return;
            event.preventDefault();
            targetElement.scrollIntoView({ behavior: 'smooth', block: 'start' });
            closeNavbar();
        });
    });

    document.querySelectorAll('.navbar a').forEach((link) => {
        link.addEventListener('click', function () {
            if (window.innerWidth <= 768) {
                closeNavbar();
            }
        });
    });
});

document.addEventListener('visibilitychange',
    function () {
        if (document.visibilityState === "visible") {
            document.title = "Portfolio | Sarika Maurya";
            $("#favicon").attr("href", "assets/images/favicon.png");
        }
        else {
            document.title = "Come Back To Portfolio";
            $("#favicon").attr("href", "assets/images/favhand.png");
        }
    });


// <!-- typed js effect starts -->
var typed = new Typed(".typing-text", {
    strings: ["MERN Stack development", "Java development", "web application development", "problem solving"],
    loop: true,
    typeSpeed: 50,
    backSpeed: 25,
    backDelay: 500,
});
// <!-- typed js effect ends -->

// Projects, skills and experience are rendered by portfolio-content.js.

// <!-- tilt js effect starts -->
VanillaTilt.init(document.querySelectorAll(".tilt"), {
    max: 15,
});
// <!-- tilt js effect ends -->


// pre loader start
// function loader() {
//     document.querySelector('.loader-container').classList.add('fade-out');
// }
// function fadeOut() {
//     setInterval(loader, 500);
// }
// window.onload = fadeOut;
// pre loader end

// disable developer mode
document.onkeydown = function (e) {
    if (e.keyCode == 123) {
        return false;
    }
    if (e.ctrlKey && e.shiftKey && e.keyCode == 'I'.charCodeAt(0)) {
        return false;
    }
    if (e.ctrlKey && e.shiftKey && e.keyCode == 'C'.charCodeAt(0)) {
        return false;
    }
    if (e.ctrlKey && e.shiftKey && e.keyCode == 'J'.charCodeAt(0)) {
        return false;
    }
    if (e.ctrlKey && e.keyCode == 'U'.charCodeAt(0)) {
        return false;
    }
}

// Start of Tawk.to Live Chat
var Tawk_API = Tawk_API || {}, Tawk_LoadStart = new Date();
(function () {
    var s1 = document.createElement("script"), s0 = document.getElementsByTagName("script")[0];
    s1.async = true;
    s1.src = '#';
    s1.charset = 'UTF-8';
    s1.setAttribute('crossorigin', '*');
    s0.parentNode.insertBefore(s1, s0);
})();
// End of Tawk.to Live Chat


// Shared one-time section entrances are managed by portfolio-motion.js.
