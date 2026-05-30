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

function loadSliderImages(slider) {
  slider.querySelectorAll('img[data-src]').forEach(img => {
    img.src = img.dataset.src;
    img.removeAttribute('data-src');
  });
}

function showSliderImage(slider, index) {
  const slides = Array.from(slider.querySelectorAll('.item-card__slide'));
  if (!slides.length) return;

  const nextIndex = (index + slides.length) % slides.length;
  loadSliderImages(slider);
  slides.forEach((slide, i) => slide.classList.toggle('is-active', i === nextIndex));
  slider.dataset.currentSlide = String(nextIndex);

  const count = slider.querySelector('[data-slider-count]');
  if (count) count.textContent = `${nextIndex + 1}/${slides.length}`;
}

function setupSliderSwipe(slider) {
  let startX = 0;
  let startY = 0;
  let pointerId = null;
  let tracking = false;

  slider.addEventListener('pointerdown', e => {
    if (e.button !== undefined && e.button !== 0) return;
    if (e.target.closest('button, .item-card__menu')) return;

    startX = e.clientX;
    startY = e.clientY;
    pointerId = e.pointerId;
    tracking = true;
  });

  slider.addEventListener('pointerup', e => {
    if (!tracking || e.pointerId !== pointerId) return;
    tracking = false;

    const deltaX = e.clientX - startX;
    const deltaY = e.clientY - startY;
    const isHorizontalSwipe = Math.abs(deltaX) >= 45 && Math.abs(deltaX) > Math.abs(deltaY) * 1.4;
    if (!isHorizontalSwipe) return;

    e.preventDefault();
    const current = Number.parseInt(slider.dataset.currentSlide || '0', 10);
    showSliderImage(slider, current + (deltaX < 0 ? 1 : -1));
  });

  slider.addEventListener('pointercancel', e => {
    if (e.pointerId === pointerId) tracking = false;
  });
}

function initLazySliders() {
  const sliders = Array.from(document.querySelectorAll('[data-slider]')).filter(slider => !slider.dataset.sliderReady);
  if (!sliders.length) return;

  sliders.forEach(slider => {
    slider.dataset.sliderReady = '1';
    slider.dataset.currentSlide = slider.dataset.currentSlide || '0';
    setupSliderSwipe(slider);
  });

  if (!('IntersectionObserver' in window)) {
    sliders.forEach(loadSliderImages);
    return;
  }

  const observer = new IntersectionObserver((entries, obs) => {
    entries.forEach(entry => {
      if (!entry.isIntersecting) return;
      loadSliderImages(entry.target);
      obs.unobserve(entry.target);
    });
  }, { rootMargin: '150px 0px' });

  sliders.forEach(slider => observer.observe(slider));
}

document.addEventListener('click', function (e) {
  const button = e.target.closest('[data-slider-prev], [data-slider-next]');
  if (!button) return;

  e.preventDefault();
  e.stopPropagation();

  const slider = button.closest('[data-slider]');
  const current = Number.parseInt(slider.dataset.currentSlide || '0', 10);
  const delta = button.matches('[data-slider-prev]') ? -1 : 1;
  showSliderImage(slider, current + delta);
});

document.addEventListener('keydown', function (e) {
  if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
  const slider = e.target.closest('[data-slider]');
  if (!slider) return;

  e.preventDefault();
  const current = Number.parseInt(slider.dataset.currentSlide || '0', 10);
  showSliderImage(slider, current + (e.key === 'ArrowLeft' ? -1 : 1));
});

document.addEventListener('DOMContentLoaded', initLazySliders);
document.body.addEventListener('htmx:afterSwap', initLazySliders);
initLazySliders();
