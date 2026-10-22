// Add a copy button to every code block in an article.
// Progressive enhancement: without JavaScript the blocks are unchanged.
document.addEventListener('DOMContentLoaded', function () {
    document.querySelectorAll('.article-post pre > code').forEach(function (code) {
        var pre = code.parentElement;
        var button = document.createElement('button');
        button.type = 'button';
        button.className = 'copy-code';
        button.textContent = 'Copy';

        button.addEventListener('click', function () {
            var text = code.innerText;
            var done = function (label) {
                button.textContent = label;
                setTimeout(function () { button.textContent = 'Copy'; }, 1500);
            };
            if (navigator.clipboard && navigator.clipboard.writeText) {
                navigator.clipboard.writeText(text).then(function () { done('Copied'); },
                    function () { done('Failed'); });
            } else {
                var area = document.createElement('textarea');
                area.value = text;
                area.style.position = 'fixed';
                area.style.opacity = '0';
                document.body.appendChild(area);
                area.select();
                try { document.execCommand('copy'); done('Copied'); }
                catch (e) { done('Failed'); }
                document.body.removeChild(area);
            }
        });

        pre.appendChild(button);
    });
});

// Keep the table of contents open on desktop, collapsed on phones.
if (window.matchMedia('(min-width: 768px)').matches) {
    document.querySelectorAll('details.post-toc').forEach(function (d) {
        d.open = true;
    });
}
