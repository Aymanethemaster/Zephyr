/**
 * Zero-dependency Canvas Forecast Chart
 * Draws smooth hourly temperature curves and precipitation chance bars.
 * Features fluid ease-out entrance animation, HiDPI support, and responsive resizing.
 */

import { convertTemp } from './utils.js';

export class ForecastChart {
  constructor(canvasContainerId) {
    this.container = document.getElementById(canvasContainerId);
    if (!this.container) return;

    this.canvas = document.createElement('canvas');
    this.canvas.className = 'hourly-chart-canvas';
    this.canvas.setAttribute('role', 'img');
    this.canvas.setAttribute('aria-label', '24-hour hourly temperature spline chart and precipitation probability bars');
    this.container.appendChild(this.canvas);
    this.ctx = this.canvas.getContext('2d');

    this.hourlyData = null;
    this.unit = 'C';
    this.hoverIndex = -1;
    this.animProgress = 1;
    this.animFrameId = null;

    this.initEvents();

    // ResizeObserver tracks both window resize and CSS container/zoom changes
    if (window.ResizeObserver) {
      this.resizeObserver = new ResizeObserver(() => {
        this.resize();
        this.render();
      });
      this.resizeObserver.observe(this.container);
    } else {
      window.addEventListener('resize', () => {
        this.resize();
        this.render();
      });
    }

    this.resize();
  }

  initEvents() {
    this.canvas.addEventListener('mousemove', (e) => this.handlePointer(e));
    this.canvas.addEventListener('mouseleave', () => {
      if (this.hoverIndex !== -1) {
        this.hoverIndex = -1;
        this.render();
      }
    });

    // Touch events for mobile scrub
    const handleTouch = (e) => {
      if (e.touches && e.touches.length > 0) {
        this.handlePointer(e.touches[0]);
      }
    };

    this.canvas.addEventListener('touchstart', handleTouch, { passive: true });
    this.canvas.addEventListener('touchmove', handleTouch, { passive: true });
    this.canvas.addEventListener('touchend', () => {
      if (this.hoverIndex !== -1) {
        this.hoverIndex = -1;
        this.render();
      }
    });
    this.canvas.addEventListener('touchcancel', () => {
      if (this.hoverIndex !== -1) {
        this.hoverIndex = -1;
        this.render();
      }
    });
  }

  setData(hourlyData, unit = 'C') {
    this.hourlyData = hourlyData;
    this.unit = unit;
    this.hoverIndex = -1;
    this.resize();

    // Check prefers-reduced-motion
    const prefersReducedMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (prefersReducedMotion) {
      this.animProgress = 1;
      this.render();
      return;
    }

    this.startEntranceAnimation();
  }

  startEntranceAnimation() {
    if (this.animFrameId) {
      cancelAnimationFrame(this.animFrameId);
    }

    const duration = 450; // ms
    const startTime = performance.now();

    const frame = (now) => {
      const elapsed = now - startTime;
      const t = Math.min(1, elapsed / duration);
      // Cubic ease-out deceleration: 1 - (1 - t)^3
      this.animProgress = 1 - Math.pow(1 - t, 3);

      this.render();

      if (t < 1) {
        this.animFrameId = requestAnimationFrame(frame);
      } else {
        this.animProgress = 1;
        this.animFrameId = null;
      }
    };

    this.animProgress = 0.05;
    this.animFrameId = requestAnimationFrame(frame);
  }

  resize() {
    if (!this.container) return;
    const dpr = window.devicePixelRatio || 1;
    const rect = this.container.getBoundingClientRect();
    const width = Math.max(Math.floor(rect.width), 280);
    const height = Math.max(Math.floor(rect.height), 120);

    this.canvas.width = Math.floor(width * dpr);
    this.canvas.height = Math.floor(height * dpr);
    this.canvas.style.width = `${width}px`;
    this.canvas.style.height = `${height}px`;

    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.logicalWidth = width;
    this.logicalHeight = height;
  }

  handlePointer(e) {
    if (!this.hourlyData || !this.hourlyData.times || this.hourlyData.times.length === 0) return;
    
    // If animation is running during user hover, complete it immediately
    if (this.animFrameId) {
      cancelAnimationFrame(this.animFrameId);
      this.animFrameId = null;
      this.animProgress = 1;
    }

    const rect = this.canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const n = Math.min(24, this.hourlyData.times.length);
    if (n < 2) return;

    const paddingX = 28;
    const chartWidth = Math.max(this.logicalWidth - paddingX * 2, 100);
    const step = chartWidth / (n - 1);

    if (x < paddingX - step * 0.5 || x > paddingX + (n - 1) * step + step * 0.5) {
      if (this.hoverIndex !== -1) {
        this.hoverIndex = -1;
        this.render();
      }
      return;
    }

    const index = Math.max(0, Math.min(n - 1, Math.round((x - paddingX) / step)));
    if (index !== this.hoverIndex) {
      this.hoverIndex = index;
      this.render();
    }
  }

  render() {
    if (!this.hourlyData || !this.hourlyData.times || this.hourlyData.times.length === 0) {
      return;
    }

    const ctx = this.ctx;
    const w = this.logicalWidth;
    const h = this.logicalHeight;
    ctx.clearRect(0, 0, w, h);

    const n = Math.min(24, this.hourlyData.times.length);
    const times = this.hourlyData.times.slice(0, n);
    const temps = this.hourlyData.temperatures.slice(0, n).map(t => convertTemp(t, this.unit));
    const rains = this.hourlyData.precipProbabilities ? this.hourlyData.precipProbabilities.slice(0, n) : [];

    const minTemp = Math.min(...temps);
    const maxTemp = Math.max(...temps);
    const actualSpan = maxTemp - minTemp;
    const displayMin = actualSpan === 0 ? minTemp - 2 : minTemp - 1;
    const displayMax = actualSpan === 0 ? maxTemp + 2 : maxTemp + 1;
    const tempRange = Math.max(displayMax - displayMin, 4);

    const paddingX = 28;
    const paddingTop = 28;
    const paddingBottom = 36;
    const chartHeight = Math.max(h - paddingTop - paddingBottom, 40);
    const chartWidth = Math.max(w - paddingX * 2, 100);
    const step = n > 1 ? chartWidth / (n - 1) : chartWidth;

    const progress = this.animProgress;

    // Calculate (x, y) coordinates for spline with animated progression
    const baselineY = h - 14;
    const points = [];
    for (let i = 0; i < n; i++) {
      const x = paddingX + i * step;
      const norm = (temps[i] - displayMin) / tempRange;
      const targetY = paddingTop + (1 - norm) * chartHeight;
      // Interpolate from bottom baseline toward target spline height
      const y = baselineY - (baselineY - targetY) * progress;
      points.push({ x, y, temp: temps[i], time: times[i], rain: rains[i] || 0 });
    }

    // 1. Draw Precipitation Bars at the bottom
    const barWidth = Math.max(step * 0.45, 4);
    for (let i = 0; i < n; i++) {
      const p = points[i];
      if (p.rain > 0) {
        const targetBarHeight = (p.rain / 100) * 22;
        const barHeight = targetBarHeight * progress;
        const barX = p.x - barWidth / 2;
        const barY = h - 14 - barHeight;

        ctx.fillStyle = `rgba(56, 189, 248, ${(0.25 + (p.rain / 100) * 0.5) * progress})`;
        ctx.beginPath();
        if (ctx.roundRect) {
          ctx.roundRect(barX, barY, barWidth, barHeight, [3, 3, 0, 0]);
        } else {
          ctx.rect(barX, barY, barWidth, barHeight);
        }
        ctx.fill();
      }
    }

    // 2. Draw Soft Spline Area Gradient
    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    for (let i = 0; i < points.length - 1; i++) {
      const p0 = points[i];
      const p1 = points[i + 1];
      const cx = (p0.x + p1.x) / 2;
      ctx.bezierCurveTo(cx, p0.y, cx, p1.y, p1.x, p1.y);
    }
    // Complete gradient polygon
    ctx.lineTo(points[points.length - 1].x, h - 14);
    ctx.lineTo(points[0].x, h - 14);
    ctx.closePath();

    const areaGrad = ctx.createLinearGradient(0, paddingTop, 0, h - 14);
    areaGrad.addColorStop(0, `rgba(255, 255, 255, ${0.28 * progress})`);
    areaGrad.addColorStop(0.6, `rgba(255, 255, 255, ${0.08 * progress})`);
    areaGrad.addColorStop(1, 'rgba(255, 255, 255, 0)');
    ctx.fillStyle = areaGrad;
    ctx.fill();

    // 3. Draw Temperature Spline Stroke
    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    for (let i = 0; i < points.length - 1; i++) {
      const p0 = points[i];
      const p1 = points[i + 1];
      const cx = (p0.x + p1.x) / 2;
      ctx.bezierCurveTo(cx, p0.y, cx, p1.y, p1.x, p1.y);
    }
    ctx.strokeStyle = `rgba(255, 255, 255, ${0.85 * progress})`;
    ctx.lineWidth = 2.5;
    ctx.lineCap = 'round';
    ctx.stroke();

    // 4. Draw Selected points, values, and time labels
    ctx.font = '500 11px "Inter", system-ui, -apple-system, sans-serif';
    ctx.textAlign = 'center';

    for (let i = 0; i < n; i++) {
      const p = points[i];
      const isKeyPoint = i % 3 === 0 || i === this.hoverIndex;

      // Point circle
      ctx.beginPath();
      ctx.arc(p.x, p.y, isKeyPoint ? 3.5 : 2, 0, Math.PI * 2);
      ctx.fillStyle = isKeyPoint ? `rgba(255, 255, 255, ${progress})` : `rgba(255, 255, 255, ${0.5 * progress})`;
      ctx.fill();

      // Temperature label on key points
      if (isKeyPoint && progress > 0.6) {
        const textAlpha = (progress - 0.6) / 0.4;
        ctx.save();
        ctx.shadowColor = `rgba(0, 0, 0, ${0.5 * textAlpha})`;
        ctx.shadowBlur = 4;
        ctx.shadowOffsetY = 1;
        ctx.fillStyle = `rgba(255, 255, 255, ${textAlpha})`;
        ctx.fillText(`${p.temp}°`, p.x, p.y - 8);
        ctx.restore();
      }
    }

    // 5. Draw Time labels along bottom axis
    ctx.font = '500 10px "Inter", system-ui, -apple-system, sans-serif';
    ctx.fillStyle = `rgba(255, 255, 255, ${0.65 * progress})`;
    ctx.textAlign = 'center';
    for (let i = 0; i < n; i += 4) {
      const p = points[i];
      if (p && p.time) {
        ctx.fillText(p.time, p.x, h - 2);
      }
    }

    // 6. Draw Hover Indicator & Floating Tooltip if active
    if (this.hoverIndex >= 0 && this.hoverIndex < n && progress >= 0.95) {
      const p = points[this.hoverIndex];

      // Vertical guide line
      ctx.beginPath();
      ctx.setLineDash([3, 3]);
      ctx.moveTo(p.x, paddingTop - 4);
      ctx.lineTo(p.x, h - 14);
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.4)';
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.setLineDash([]);

      // Glow point
      ctx.beginPath();
      ctx.arc(p.x, p.y, 6, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255, 255, 255, 0.3)';
      ctx.fill();

      ctx.beginPath();
      ctx.arc(p.x, p.y, 3.5, 0, Math.PI * 2);
      ctx.fillStyle = '#ffffff';
      ctx.fill();

      // Floating Badge Tooltip
      const tipText = `${p.time}: ${p.temp}°${p.rain > 0 ? ` · ${p.rain}% rain` : ''}`;
      ctx.save();
      ctx.font = '600 11px "Inter", system-ui, -apple-system, sans-serif';
      const textWidth = ctx.measureText(tipText).width;
      const tipX = Math.max(textWidth / 2 + 8, Math.min(w - textWidth / 2 - 8, p.x));
      const tipY = Math.max(14, p.y - 18);

      ctx.fillStyle = 'rgba(15, 23, 42, 0.94)';
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.25)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      if (ctx.roundRect) {
        ctx.roundRect(tipX - textWidth / 2 - 7, tipY - 11, textWidth + 14, 20, 5);
      } else {
        ctx.rect(tipX - textWidth / 2 - 7, tipY - 11, textWidth + 14, 20);
      }
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = '#ffffff';
      ctx.textAlign = 'center';
      ctx.fillText(tipText, tipX, tipY + 3);
      ctx.restore();
    }
  }
}
