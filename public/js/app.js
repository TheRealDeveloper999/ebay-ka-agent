'use strict';

// Nav settings "···" dropdown toggle
document.addEventListener('click', function (e) {
  const btn = e.target.closest('.nav-settings__btn');
  const dropdown = document.querySelector('.nav-settings__dropdown');
  if (!dropdown) return;
  if (btn) {
    const isOpen = !dropdown.hidden;
    dropdown.hidden = isOpen;
    btn.setAttribute('aria-expanded', String(!isOpen));
  } else if (!e.target.closest('.nav-settings__dropdown')) {
    dropdown.hidden = true;
    const navBtn = document.querySelector('.nav-settings__btn');
    if (navBtn) navBtn.setAttribute('aria-expanded', 'false');
  }
});

// Item card "···" dropdown toggle
document.addEventListener('click', function (e) {
  const btn = e.target.closest('.item-card__menu-btn');

  if (!btn) {
    // Click outside any dropdown: close all
    if (!e.target.closest('.item-card__dropdown')) {
      document.querySelectorAll('.item-card__dropdown').forEach(d => { d.hidden = true; });
      document.querySelectorAll('.item-card__menu').forEach(m => m.classList.remove('item-card__menu--open'));
    }
    return;
  }

  e.preventDefault();
  e.stopPropagation();

  const menu = btn.closest('.item-card__menu');
  const dropdown = menu.querySelector('.item-card__dropdown');
  const opening = dropdown.hidden;

  // Close all first
  document.querySelectorAll('.item-card__dropdown').forEach(d => { d.hidden = true; });
  document.querySelectorAll('.item-card__menu').forEach(m => m.classList.remove('item-card__menu--open'));

  // Then open this one if it was closed
  if (opening) {
    dropdown.hidden = false;
    menu.classList.add('item-card__menu--open');
  }
});
