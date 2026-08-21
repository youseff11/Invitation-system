document.addEventListener('DOMContentLoaded', () => {
    document.querySelectorAll('.toast').forEach((el) => {
        setTimeout(() => el.remove(), 4500);
    });

    const root = document.documentElement;
    const savedTheme = localStorage.getItem('layla-theme');

    if (savedTheme === 'dark') {
        root.classList.add('dark-mode');
    }

    const themeButtons = document.querySelectorAll('#theme-toggle, .nav-theme-toggle, .theme-fab');

    const updateThemeButtons = () => {
        const isDark = root.classList.contains('dark-mode');
        themeButtons.forEach((button) => {
            button.textContent = isDark ? '☾' : '☼';
            button.setAttribute('aria-label', isDark ? 'تفعيل الوضع الفاتح' : 'تفعيل الوضع الداكن');
            button.setAttribute('title', isDark ? 'الوضع الفاتح' : 'الوضع الداكن');
        });
    };

    themeButtons.forEach((button) => {
        button.addEventListener('click', () => {
            root.classList.toggle('dark-mode');
            const isDark = root.classList.contains('dark-mode');
            localStorage.setItem('layla-theme', isDark ? 'dark' : 'light');
            updateThemeButtons();
        });
    });

    updateThemeButtons();

    document.querySelectorAll('[data-open-modal]').forEach((button) => {
        button.addEventListener('click', () => {
            document.getElementById(button.dataset.openModal)?.classList.add('open');
        });
    });

    document.querySelectorAll('[data-close-modal]').forEach((button) => {
        button.addEventListener('click', () => {
            button.closest('.modal-backdrop')?.classList.remove('open');
        });
    });

    document.querySelectorAll('.modal-backdrop').forEach((modal) => {
        modal.addEventListener('click', (event) => {
            if (event.target === modal) {
                modal.classList.remove('open');
            }
        });
    });

    document.querySelectorAll('[data-scroll]').forEach((button) => {
        button.addEventListener('click', () => {
            document.querySelector(button.dataset.scroll)?.scrollIntoView({ behavior: 'smooth' });
        });
    });

    const countdown = document.querySelector('[data-countdown]');

    if (countdown && countdown.dataset.countdown) {
        const target = new Date(countdown.dataset.countdown).getTime();

        const tick = () => {
            const diff = Math.max(0, target - Date.now());
            const parts = {
                days: Math.floor(diff / 86400000),
                hours: Math.floor(diff / 3600000) % 24,
                minutes: Math.floor(diff / 60000) % 60,
                seconds: Math.floor(diff / 1000) % 60,
            };

            Object.entries(parts).forEach(([key, value]) => {
                const element = countdown.querySelector(`[data-time="${key}"]`);
                if (element) {
                    element.textContent = String(value).padStart(2, '0');
                }
            });
        };

        tick();
        setInterval(tick, 1000);
    }

    document.querySelectorAll('[data-checkin]').forEach((button) => {
        button.addEventListener('click', async () => {
            const response = await fetch(button.dataset.checkin, {
                method: 'POST',
                headers: {
                    'X-CSRFToken': document.querySelector('[name=csrfmiddlewaretoken]')?.value || '',
                },
            });

            if (response.ok) {
                const data = await response.json();
                button.textContent = data.checked_in ? 'تم الدخول' : 'تسجيل دخول';
                button.classList.toggle('btn-gold', data.checked_in);
            }
        });
    });
});
