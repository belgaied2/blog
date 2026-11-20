// Expand article images into a full-viewport overlay instead of a new tab.
// Without JavaScript the anchor still opens the image directly.
(function () {
    'use strict';

    var overlay = null;
    var overlayImg = null;
    var closeBtn = null;
    var originalLink = null;
    var lastFocused = null;

    function build() {
        overlay = document.createElement('div');
        overlay.className = 'lightbox';
        overlay.setAttribute('role', 'dialog');
        overlay.setAttribute('aria-modal', 'true');
        overlay.setAttribute('aria-label', 'Image preview');
        overlay.hidden = true;

        closeBtn = document.createElement('button');
        closeBtn.type = 'button';
        closeBtn.className = 'lightbox-close';
        closeBtn.setAttribute('aria-label', 'Close image');
        closeBtn.innerHTML = '&times;';

        originalLink = document.createElement('a');
        originalLink.className = 'lightbox-original';
        originalLink.target = '_blank';
        originalLink.rel = 'noopener';
        originalLink.textContent = 'Open original';

        overlayImg = document.createElement('img');
        overlayImg.alt = '';

        overlay.appendChild(closeBtn);
        overlay.appendChild(originalLink);
        overlay.appendChild(overlayImg);
        document.body.appendChild(overlay);

        closeBtn.addEventListener('click', close);
        overlay.addEventListener('click', function (event) {
            if (event.target === overlay) {
                close();
            }
        });
        document.addEventListener('keydown', function (event) {
            if (event.key === 'Escape' && !overlay.hidden) {
                close();
            }
        });
    }

    function open(link) {
        if (!overlay) {
            build();
        }
        var img = link.querySelector('img');
        if (!img) {
            return;
        }
        overlayImg.src = link.getAttribute('href');
        overlayImg.alt = img.getAttribute('alt') || '';
        originalLink.href = link.getAttribute('href');
        lastFocused = link;
        overlay.hidden = false;
        document.documentElement.classList.add('lightbox-open');
        closeBtn.focus();
    }

    function close() {
        if (!overlay || overlay.hidden) {
            return;
        }
        overlay.hidden = true;
        overlayImg.removeAttribute('src');
        document.documentElement.classList.remove('lightbox-open');
        if (lastFocused) {
            lastFocused.focus();
        }
    }

    document.addEventListener('click', function (event) {
        var link = event.target.closest('.article-post a.article-image');
        if (!link) {
            return;
        }
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) {
            return;
        }
        event.preventDefault();
        open(link);
    });
})();
