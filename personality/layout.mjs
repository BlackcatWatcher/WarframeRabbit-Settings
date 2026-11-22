export default ((function applyRabbitImageLayout(doc, fitWidth = true) {
  const win = doc.defaultView;
  const card = doc.querySelector('#rabbit-card');
  if (!card) return false;
  const styleOf = node => win.getComputedStyle(node);
  const number = value => parseFloat(value) || 0;

  // 以设定宽度为下限，只在面积减小且比例更接近正方形时扩宽；重复预览始终从同一基准开始。
  const baseWidth = number(styleOf(card).getPropertyValue('--wr-base-width'));
  if (fitWidth && baseWidth > 0 && card.matches('.wr-document')) {
    const measureAt = width => {
      card.style.setProperty('--wr-width', width + 'px');
      applyRabbitImageLayout(doc, false);
      const rect = card.getBoundingClientRect();
      const w = Math.ceil(rect.width), h = Math.ceil(rect.height);
      return {width, area:w*h, aspect:Math.max(w/h,h/w), w, h};
    };
    const baseline = measureAt(baseWidth);
    let best = baseline;
    const consider = width => {
      const candidate = measureAt(width);
      if (candidate.aspect > baseline.aspect || candidate.area >= baseline.area) return;
      if (candidate.area < best.area || (candidate.area === best.area && candidate.aspect < best.aspect)) best = candidate;
    };
    if (baseline.h > baseline.w) {
      const limit = Math.min(baseWidth + 200, win.innerWidth - 40);
      // 先粗选，再细化附近的换行临界点，限制长页面的排版次数。
      for (let width = baseWidth + 20; width <= limit; width += 20) consider(width);
      if (limit > baseWidth) consider(limit);
      if (best !== baseline) {
        const start = Math.max(baseWidth + 1, best.width - 19), end = Math.min(limit, best.width + 19);
        for (let width = start; width <= end; width++) consider(width);
      }
    }
    card.style.setProperty('--wr-width', best.width + 'px');
  }
  const packedGroups = [...card.querySelectorAll('.wr-card-group-packed')].reverse().map(group => {
    const panels = [...group.querySelectorAll('.wr-ui-card')].filter(panel =>
      panel.parentElement === group || (panel.parentElement.classList.contains('wr-card-pack-column') && panel.parentElement.parentElement.parentElement === group));
    panels.forEach((panel, index) => {
      if (panel.dataset.cardPackIndex === undefined) panel.dataset.cardPackIndex = String(index);
      panel.style.removeProperty('--ui-card-packed-height');
    });
    panels.sort((a, b) => number(a.dataset.cardPackIndex) - number(b.dataset.cardPackIndex));
    group.replaceChildren(...panels);
    return {group, panels};
  });

  // 四档长度以当前阅读容器为基准；测量只用于选档，最终宽度始终是 25% 的整数倍。
  const quarterNodes = card.querySelectorAll('.wr-ui-quote,.wr-ui-callout,.wr-ui-divider,.wr-time-progress,[class*="wr-width-quarters-"]');
  for (const node of quarterNodes) {
    if (node.closest('[data-quarter-measure]')) continue;
    const explicit = node.className.match(/(?:^|\s)wr-width-quarters-([1-4])(?:\s|$)/);
    if (!explicit && node.style.width && !node.dataset.widthQuarter) continue;
    const parent = node.parentElement;
    if (!parent) continue;
    const parentStyle = styleOf(parent);
    const available = parent.clientWidth - number(parentStyle.paddingLeft) - number(parentStyle.paddingRight);
    if (available <= 0) continue;
    let quarter = explicit ? Number(explicit[1]) : 4;
    if (!explicit && node.textContent.trim()) {
      const clone = node.cloneNode(true);
      clone.dataset.quarterMeasure = 'true';
      clone.removeAttribute('id');
      clone.querySelectorAll('[id]').forEach(child => child.removeAttribute('id'));
      Object.assign(clone.style, {position:'absolute',visibility:'hidden',pointerEvents:'none',width:'max-content',minWidth:'0',maxWidth:'none',height:'auto',flex:'none'});
      parent.appendChild(clone);
      let needed;
      if (node.matches('.wr-time-progress')) {
        // 标签、间距和时间属于同一档宽度；进度条为时间文字额外留出 20px。
        const time = clone.querySelector('time'), label = clone.querySelector(':scope > span'), progress = clone.querySelector('progress');
        clone.style.gridTemplateColumns = 'max-content max-content';
        if (progress) { progress.style.width = '0'; progress.style.minWidth = '0'; }
        if (time) { time.style.width = 'max-content'; time.style.maxWidth = 'none'; }
        const css = styleOf(clone);
        needed = (label?.getBoundingClientRect().width || 0) + (label?.textContent.trim() ? number(css.columnGap) : 0)
          + (time?.getBoundingClientRect().width || 0) + 20 + number(css.paddingLeft) + number(css.paddingRight) + number(css.borderLeftWidth) + number(css.borderRightWidth);
      } else {
        needed = Math.max(clone.scrollWidth, clone.getBoundingClientRect().width);
      }
      clone.remove();
      quarter = Math.max(1, Math.min(4, Math.ceil((needed + 1) / (available / 4))));
    }
    node.style.width = (quarter * 25) + '%';
    node.style.maxWidth = '100%';
    node.style.boxSizing = 'border-box';
    node.style.alignSelf = 'start';
    node.style.flexBasis = 'auto';
    node.dataset.widthQuarter = String(quarter);
  }

  // 每组独立测量。先穷举一个行集合的两列划分，再用子集动态规划最小化全部行高及行间距。
  for (const {group, panels} of packedGroups) {
    if (!panels.length) continue;
    const css = styleOf(group);
    const gap = number(css.rowGap), columnGap = number(css.columnGap);
    const available = group.clientWidth - number(css.paddingLeft) - number(css.paddingRight);
    const width = Math.max(...panels.map(panel => panel.getBoundingClientRect().width));
    // 宽度不足两列时恢复原始单列顺序，不留下上次预览的分组容器或拉伸高度。
    if (2 * width + columnGap > available + .5) continue;
    const heights = panels.map(panel => panel.getBoundingClientRect().height);
    const measure = doc.createElement('div');
    Object.assign(measure.style, {position:'absolute',visibility:'hidden',width:'0',height:css.getPropertyValue('--ui-card-group-row-max-height').trim() || '800px'});
    group.appendChild(measure);
    const limit = Math.max(measure.getBoundingClientRect().height, ...heights);
    measure.remove();
    const size = 1 << panels.length, sums = new Float64Array(size), rows = new Array(size);
    for (let mask = 1; mask < size; mask++) {
      const bit = mask & -mask, rest = mask ^ bit;
      sums[mask] = sums[rest] + heights[31 - Math.clz32(bit)] + (rest ? gap : 0);
      for (let left = mask; left; left = (left - 1) & mask) {
        if (!(left & bit)) continue;
        const right = mask ^ left, height = Math.max(sums[left], sums[right]);
        if (height > limit + .01) continue;
        if (!rows[mask] || height < rows[mask].height - .01) rows[mask] = {left, right, height};
      }
    }
    const costs = new Float64Array(size).fill(Infinity), choices = new Int32Array(size), counts = new Int32Array(size);
    costs[0] = 0;
    for (let mask = 1; mask < size; mask++) {
      const first = mask & -mask;
      for (let row = mask; row; row = (row - 1) & mask) {
        if (!(row & first) || !rows[row]) continue;
        const rest = mask ^ row, cost = rows[row].height + (rest ? gap : 0) + costs[rest];
        if (cost < costs[mask] - .01 || (Math.abs(cost - costs[mask]) <= .01 && counts[rest] + 1 < counts[mask])) {
          costs[mask] = cost; choices[mask] = row; counts[mask] = counts[rest] + 1;
        }
      }
    }
    for (let mask = size - 1; mask;) {
      const subset = choices[mask], plan = rows[subset], row = doc.createElement('div');
      row.className = 'wr-card-pack-row';
      row.style.height = plan.height + 'px';
      for (const bits of [plan.left, plan.right]) {
        if (!bits) continue;
        const column = doc.createElement('div');
        column.className = 'wr-card-pack-column';
        column.style.width = width + 'px';
        column.style.gap = gap + 'px';
        const indices = heights.map((_, i) => i).filter(i => bits & (1 << i));
        indices.forEach((index, position) => {
          const stretch = position === indices.length - 1 ? plan.height - sums[bits] : 0;
          panels[index].style.setProperty('--ui-card-packed-height', (heights[index] + stretch) + 'px');
          column.appendChild(panels[index]);
        });
        row.appendChild(column);
      }
      group.appendChild(row);
      mask ^= subset;
    }
  }

  // 数值保持在滑块上方，临近端点时按实际标签宽度收回容器内。
  for (const slider of card.querySelectorAll('.wr-ui-slider')) {
    const row = slider.querySelector(':scope > .wr-slider-current-row');
    const label = row?.querySelector('.wr-slider-current');
    const thumb = slider.querySelector(':scope > .wr-slider-track > .wr-slider-thumb');
    if (!row || !label || !thumb || row.clientWidth <= 0) continue;
    const rowRect = row.getBoundingClientRect(), thumbRect = thumb.getBoundingClientRect();
    if (rowRect.width <= 0) continue;
    const scale = rowRect.width / row.clientWidth;
    const point = (thumbRect.left + thumbRect.width / 2 - rowRect.left) / scale;
    const half = label.offsetWidth / 2;
    label.style.left = Math.max(half, Math.min(row.clientWidth - half, point)) + 'px';
    label.style.transform = 'translateX(-50%)';
  }

  // 试排只测组件尺寸；裁剪标记和角色碰撞只在最终宽度计算一次。
  if (!fitWidth) return false;

  // 卡片先保留完整组件 DOM，再按实际溢出决定渐隐及省略标记；重复预览会重新计算。
  for (const panel of [...card.querySelectorAll('.wr-ui-card')].reverse()) {
    const viewport = panel.querySelector(':scope > .wr-card-viewport');
    const window = viewport?.querySelector(':scope > .wr-card-window');
    const body = window?.querySelector(':scope > .wr-card-body');
    const markers = viewport?.querySelector(':scope > .wr-card-overflow-markers');
    if (!window || !body || !markers) continue;
    markers.replaceChildren();
    const right = panel.classList.contains('wr-card-clip-right') && window.scrollWidth > window.clientWidth + 1;
    const bottom = panel.classList.contains('wr-card-clip-bottom') && window.scrollHeight > window.clientHeight + 1;
    window.dataset.overflowRight = String(right);
    window.dataset.overflowBottom = String(bottom);
    if (right || bottom) {
      const marker = doc.createElement('span');
      marker.className = 'wr-card-overflow-marker';
      marker.textContent = '...';
      markers.appendChild(marker);
    }
  }

  if (card.dataset.layoutOwner === 'page' && card.dataset.themeFrame !== 'true') return false;
  const avatar = card.querySelector('.wr-avatar');
  const picture = avatar?.querySelector('img');
  if (!avatar || !picture || styleOf(avatar).position !== 'absolute') return false;
  const updateAvatarLayer = () => {
    const content = card.querySelector('.wr-content');
    // 半透明角色放在正文下方；按正文层级定位，保留各主题的背景与底色层。
    avatar.style.zIndex = number(styleOf(avatar).opacity) < 1
      ? String(number(content ? styleOf(content).zIndex : '1') - 1) : '2147483647';
  };
  avatar.style.pointerEvents = 'none';
  avatar.style.bottom = 'auto';
  avatar.style.top = Math.max(card.clientHeight * 0.3, card.clientHeight - avatar.offsetHeight) + 'px';
  avatar.style.opacity = 'var(--wr-avatar-opacity)';
  updateAvatarLayer();
  if (!picture.complete || !picture.naturalWidth || number(styleOf(avatar).opacity) === 0) return false;

  const imageRect = picture.getBoundingClientRect();
  if (imageRect.width <= 0 || imageRect.height <= 0) return false;
  const width = Math.ceil(imageRect.width), height = Math.ceil(imageRect.height);
  const canvas = doc.createElement('canvas');
  canvas.width = width; canvas.height = height;
  const ctx = canvas.getContext('2d', {willReadFrequently:true});
  if (!ctx) return false;
  const s = styleOf(picture);
  const scaleX = imageRect.width / picture.offsetWidth;
  const scaleY = imageRect.height / picture.offsetHeight;
  const left = (number(s.borderLeftWidth) + number(s.paddingLeft)) * scaleX;
  const top = (number(s.borderTopWidth) + number(s.paddingTop)) * scaleY;
  const innerWidth = imageRect.width - left - (number(s.borderRightWidth) + number(s.paddingRight)) * scaleX;
  const innerHeight = imageRect.height - top - (number(s.borderBottomWidth) + number(s.paddingBottom)) * scaleY;
  let drawWidth = innerWidth, drawHeight = innerHeight;
  const naturalWidth = picture.naturalWidth, naturalHeight = picture.naturalHeight;
  if (s.objectFit === 'contain' || s.objectFit === 'cover' || s.objectFit === 'scale-down') {
    let scale = s.objectFit === 'cover' ? Math.max(innerWidth/naturalWidth, innerHeight/naturalHeight) : Math.min(innerWidth/naturalWidth, innerHeight/naturalHeight);
    if (s.objectFit === 'scale-down') scale = Math.min(1, scale);
    drawWidth = naturalWidth * scale; drawHeight = naturalHeight * scale;
  } else if (s.objectFit === 'none') {
    drawWidth = naturalWidth; drawHeight = naturalHeight;
  }
  const position = s.objectPosition.split(/\s+/);
  const offset = (value, free) => value?.endsWith('%') ? number(value)*free/100 : value==='left'||value==='top' ? 0 : value==='right'||value==='bottom' ? free : value==='center'||!value ? free/2 : number(value);
  ctx.save(); ctx.beginPath(); ctx.rect(left,top,innerWidth,innerHeight); ctx.clip();
  ctx.drawImage(picture,left+offset(position[0],innerWidth-drawWidth),top+offset(position[1],innerHeight-drawHeight),drawWidth,drawHeight); ctx.restore();
  let pixels;
  try { pixels = ctx.getImageData(0,0,width,height).data; } catch (_) { return false; }
  // 积分 Alpha 图只记录实际有透明度的像素；透明留白不会触发淡化。
  const stride = width+1, sums = new Uint32Array((width+1)*(height+1));
  for (let y=0;y<height;y++) {
    let row = 0;
    for (let x=0;x<width;x++) {row += pixels[(y*width+x)*4+3] > 0 ? 1 : 0; sums[(y+1)*stride+x+1] = sums[y*stride+x+1]+row;}
  }
  const overlaps = rect => rect.right>imageRect.left && rect.left<imageRect.right && rect.bottom>imageRect.top && rect.top<imageRect.bottom && rect.width>0 && rect.height>0;
  const alphaUnder = rect => {
    if (!overlaps(rect)) return false;
    const x0=Math.max(0,Math.floor(rect.left-imageRect.left)), y0=Math.max(0,Math.floor(rect.top-imageRect.top));
    const x1=Math.min(width,Math.ceil(rect.right-imageRect.left)), y1=Math.min(height,Math.ceil(rect.bottom-imageRect.top));
    return sums[y1*stride+x1]-sums[y0*stride+x1]-sums[y1*stride+x0]+sums[y0*stride+x0]>0;
  };
  const visibleRect = (rect, element) => {
    let left=rect.left,top=rect.top,right=rect.right,bottom=rect.bottom;
    for (let n=element;n && card.contains(n);n=n.parentElement) {
      const st=styleOf(n);
      if (st.visibility!=='visible'||st.display==='none'||number(st.opacity)===0) return null;
      const b=n.getBoundingClientRect();
      if (/hidden|clip|scroll|auto/.test(st.overflowX)) {left=Math.max(left,b.left+n.clientLeft);right=Math.min(right,b.left+n.clientLeft+n.clientWidth);}
      if (/hidden|clip|scroll|auto/.test(st.overflowY)) {top=Math.max(top,b.top+n.clientTop);bottom=Math.min(bottom,b.top+n.clientTop+n.clientHeight);}
    }
    return {left,top,right,bottom,width:right-left,height:bottom-top};
  };
  let covered=false;
  const texts=doc.createTreeWalker(card,win.NodeFilter.SHOW_TEXT);
  for (let node=texts.nextNode();node && !covered;node=texts.nextNode()) {
    const element=node.parentElement;
    if (!element || !node.textContent.trim() || element.closest('style,script,template,.wr-avatar,.wr-background,[aria-hidden="true"]')) continue;
    const range=doc.createRange(); range.selectNodeContents(node);
    if (![...range.getClientRects()].some(overlaps)) continue;
    // 分字符定位，避免把同一行中的空白当作文字。
    let index=0;
    for (const glyph of node.textContent) {
      const next=index+glyph.length;
      if (glyph.trim()) {
        range.setStart(node,index);range.setEnd(node,next);
        const stroke=number(styleOf(element).webkitTextStrokeWidth)/2;
        if ([...range.getClientRects()].some(rect=>{const visible=visibleRect({left:rect.left-stroke,top:rect.top-stroke,right:rect.right+stroke,bottom:rect.bottom+stroke},element);return visible && alphaUnder(visible);})) {covered=true;break;}
      }
      index=next;
    }
  }
  avatar.style.opacity=covered?'calc(var(--wr-avatar-opacity) * 0.5)':'var(--wr-avatar-opacity)';
  updateAvatarLayer();
  avatar.dataset.textOverlap=String(covered);
  return covered;
})
);
