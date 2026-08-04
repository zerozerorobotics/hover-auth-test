(function () {
  var SCROLL_SPY_OFFSET = 96;
  var SCROLL_LOCK_MS = 700;

  function parseJsonEl(root, selector, fallback) {
    var el = root.querySelector(selector);
    if (!el) {
      console.warn("[help-center] missing JSON block:", selector);
      return fallback;
    }
    try {
      return JSON.parse(el.textContent);
    } catch (e) {
      console.warn("[help-center] invalid JSON in", selector, e);
      return fallback;
    }
  }

  function escapeHtml(text) {
    return String(text == null ? "" : text)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  /**
   * 转义并把命中的关键词包进 <mark>。
   * 按整串大小写不敏感匹配,与后端 searchArticles 的 contains 语义一致。
   * 先在原文上切段再逐段转义,避免关键词落在 HTML 实体内部把标记切坏。
   */
  function highlightMatches(text, query) {
    var raw = String(text == null ? "" : text);
    var needle = String(query == null ? "" : query)
      .trim()
      .toLowerCase();
    if (!needle) return escapeHtml(raw);

    var haystack = raw.toLowerCase();
    // 个别字符转小写后长度会变(如 İ),下标会错位,这种情况放弃高亮
    if (haystack.length !== raw.length) return escapeHtml(raw);

    var out = "";
    var from = 0;
    var idx = haystack.indexOf(needle);
    while (idx !== -1) {
      out +=
        escapeHtml(raw.slice(from, idx)) +
        '<mark class="help-highlight">' +
        escapeHtml(raw.slice(idx, idx + needle.length)) +
        "</mark>";
      from = idx + needle.length;
      idx = haystack.indexOf(needle, from);
    }
    return out + escapeHtml(raw.slice(from));
  }

  function lockBodyScroll(lock) {
    document.documentElement.classList.toggle("help-scroll-locked", lock);
    document.body.classList.toggle("help-scroll-locked", lock);
  }

  function renderBrowseCard(article) {
    var products = "";
    if (Array.isArray(article.products) && article.products.length) {
      products = article.products.join(", ");
    } else if (typeof article.products === "string" && article.products) {
      products = article.products;
    }
    return (
      '<article class="help-article-card">' +
      '<a href="' +
      escapeHtml(article.url) +
      '" class="help-article-card__link">' +
      '<h3 class="help-article-card__title">' +
      escapeHtml(article.title) +
      "</h3>" +
      (article.summary
        ? '<p class="help-article-card__summary">' + escapeHtml(article.summary) + "</p>"
        : "") +
      (products
        ? '<p class="help-article-card__meta">Applicable Products: ' +
          escapeHtml(products) +
          "</p>"
        : "") +
      "</a></article>"
    );
  }

  function renderSearchCard(hit, query) {
    var products = hit.tags && hit.tags.length ? hit.tags.join(", ") : "";
    var meta = products
      ? '<p class="help-article-card__meta">Tags: ' + highlightMatches(products, query) + "</p>"
      : hit.category
        ? '<p class="help-article-card__meta">' + highlightMatches(hit.category, query) + "</p>"
        : "";
    // 命中在正文时 excerpt 才带上下文,优先用它,否则高亮无处可显示
    var needle = String(query == null ? "" : query)
      .trim()
      .toLowerCase();
    var body = hit.summary || hit.excerpt || "";
    if (needle && hit.excerpt && String(body).toLowerCase().indexOf(needle) === -1) {
      body = hit.excerpt;
    }
    return (
      '<article class="help-article-card">' +
      '<a href="' +
      escapeHtml(hit.url) +
      '" class="help-article-card__link">' +
      '<h3 class="help-article-card__title">' +
      highlightMatches(hit.title, query) +
      "</h3>" +
      (body
        ? '<p class="help-article-card__summary">' + highlightMatches(body, query) + "</p>"
        : "") +
      meta +
      "</a></article>"
    );
  }

  function renderPagination(container, page, totalPages, onPage) {
    if (!container) return;
    if (totalPages <= 1) {
      container.hidden = true;
      container.innerHTML = "";
      return;
    }
    container.hidden = false;
    var prevDisabled = page <= 1 ? " is-disabled" : "";
    var nextDisabled = page >= totalPages ? " is-disabled" : "";
    container.innerHTML =
      '<button type="button" class="help-pagination__btn' +
      prevDisabled +
      '" data-page="' +
      (page - 1) +
      '" aria-label="Previous page">←</button>' +
      '<span class="help-pagination__label">' +
      page +
      " / " +
      totalPages +
      "</span>" +
      '<button type="button" class="help-pagination__btn' +
      nextDisabled +
      '" data-page="' +
      (page + 1) +
      '" aria-label="Next page">→</button>';

    container.querySelectorAll("[data-page]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var target = Number(btn.getAttribute("data-page"));
        if (target >= 1 && target <= totalPages) onPage(target);
      });
    });
  }

  function nodeSortOrder(node) {
    var n = Number(node && node.sort_order);
    return Number.isFinite(n) ? n : 0;
  }

  function buildChildrenMap(browseData) {
    var children = {};
    var nodes = (browseData && browseData.nodes) || {};
    Object.keys(nodes).forEach(function (handle) {
      var parent = nodes[handle].parent || "";
      // 父节点缺失时当作根,与 Admin loadNavTree 一致
      if (parent && !nodes[parent]) parent = "";
      if (!children[parent]) children[parent] = [];
      children[parent].push(handle);
    });
    Object.keys(children).forEach(function (parent) {
      children[parent].sort(function (a, b) {
        var diff = nodeSortOrder(nodes[a]) - nodeSortOrder(nodes[b]);
        if (diff !== 0) return diff;
        return String(a).localeCompare(String(b));
      });
    });
    return children;
  }

  function collectSubtreeHandles(handle, childrenMap, acc) {
    acc = acc || [];
    acc.push(handle);
    (childrenMap[handle] || []).forEach(function (child) {
      collectSubtreeHandles(child, childrenMap, acc);
    });
    return acc;
  }

  /** DFS by Admin sort_order; articles keep each node's list order; dedupe by handle. */
  function collectArticlesInTreeOrder(browseData, rootHandles) {
    var childrenMap = buildChildrenMap(browseData);
    var seen = {};
    var list = [];
    function walk(handle) {
      var node = browseData.nodes && browseData.nodes[handle];
      if (!node) return;
      (node.articles || []).forEach(function (article) {
        if (!article.handle || seen[article.handle]) return;
        seen[article.handle] = true;
        list.push(article);
      });
      (childrenMap[handle] || []).forEach(walk);
    }
    (rootHandles || []).forEach(walk);
    return list;
  }

  function collectAllArticles(browseData) {
    var childrenMap = buildChildrenMap(browseData);
    return collectArticlesInTreeOrder(browseData, childrenMap[""] || []);
  }

  /** Articles on this node + all descendant nodes (Admin tree order, deduped by handle). */
  function articlesForNode(browseData, handle) {
    if (!handle || handle === "all") return collectAllArticles(browseData);
    return collectArticlesInTreeOrder(browseData, [handle]);
  }

  function directChildByClass(parent, className) {
    if (!parent) return null;
    for (var i = 0; i < parent.children.length; i++) {
      if (parent.children[i].classList.contains(className)) return parent.children[i];
    }
    return null;
  }

  function initHub(hub) {
    var proxyBase = hub.getAttribute("data-proxy-base") || "/apps/help/search";
    var bootstrap = parseJsonEl(hub, "[data-help-bootstrap]", {
      query: "",
      page: 1,
      limit: 10,
      node: "all",
    });
    var browseData = parseJsonEl(hub, "[data-help-browse-data]", { nodes: {} });

    var listEl = hub.querySelector("[data-help-results-list]");
    var countEl = hub.querySelector("[data-help-results-count]");
    var countNum = hub.querySelector("[data-help-results-number]");
    var countSuffix = hub.querySelector("[data-help-results-suffix]");
    var paginationEl = hub.querySelector("[data-help-pagination]");
    var form = hub.querySelector("[data-help-search-form]");
    var input = hub.querySelector("[data-help-search-input]");
    var navOpen = hub.querySelector("[data-help-nav-open]");
    var navClose = hub.querySelector("[data-help-nav-close]");
    var navPanel = hub.querySelector("[data-help-nav-panel]");
    var navOverlay = hub.querySelector("[data-help-nav-overlay]");
    var navLabel = hub.querySelector("[data-help-nav-label]");
    var navToggleCount = hub.querySelector("[data-help-nav-toggle-count]");
    var limit = bootstrap.limit || Number(hub.getAttribute("data-browse-limit")) || 10;
    var state = {
      mode: bootstrap.query ? "search" : "browse",
      query: bootstrap.query || "",
      node: bootstrap.node || "all",
      page: bootstrap.page || 1,
    };

    function closeNav() {
      if (navPanel) {
        navPanel.classList.remove("is-open");
        navPanel.setAttribute("aria-hidden", "true");
      }
      if (navOverlay) {
        navOverlay.hidden = true;
        navOverlay.classList.remove("is-visible");
      }
      if (navOpen) navOpen.setAttribute("aria-expanded", "false");
      lockBodyScroll(false);
    }

    function openNav() {
      if (navPanel) {
        navPanel.classList.add("is-open");
        navPanel.setAttribute("aria-hidden", "false");
      }
      if (navOverlay) {
        navOverlay.hidden = false;
        requestAnimationFrame(function () {
          navOverlay.classList.add("is-visible");
        });
      }
      if (navOpen) navOpen.setAttribute("aria-expanded", "true");
      lockBodyScroll(true);
      if (navClose) navClose.focus();
    }

    if (navOpen) navOpen.addEventListener("click", openNav);
    if (navClose) navClose.addEventListener("click", closeNav);
    if (navOverlay) navOverlay.addEventListener("click", closeNav);

    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && navPanel && navPanel.classList.contains("is-open")) {
        closeNav();
        if (navOpen) navOpen.focus();
      }
    });

    function syncUrl() {
      var next = new URL(window.location.href);
      if (state.mode === "search" && state.query) {
        next.searchParams.set("q", state.query);
        next.searchParams.delete("node");
      } else {
        next.searchParams.delete("q");
        if (state.node && state.node !== "all") next.searchParams.set("node", state.node);
        else next.searchParams.delete("node");
      }
      if (state.page > 1) next.searchParams.set("page", String(state.page));
      else next.searchParams.delete("page");
      window.history.replaceState({ helpHub: true }, "", next.pathname + next.search);
    }

    function setActiveNav(handle, articleCount) {
      hub.querySelectorAll("[data-help-nav-select]").forEach(function (btn) {
        var active = btn.getAttribute("data-node-handle") === handle;
        btn.classList.toggle("is-active", active);
        var badge = btn.querySelector("[data-help-nav-count]");
        if (badge) {
          if (active && articleCount != null) {
            badge.textContent = String(articleCount);
            badge.hidden = false;
          } else {
            badge.textContent = "";
            badge.hidden = true;
          }
        }
      });
      var title = "All";
      if (handle !== "all" && browseData.nodes && browseData.nodes[handle]) {
        title = browseData.nodes[handle].title || handle;
      }
      if (navLabel) navLabel.textContent = title;
      if (navOpen) navOpen.setAttribute("data-active-label", title);
      if (navToggleCount) {
        if (articleCount != null) {
          navToggleCount.textContent = String(articleCount);
          navToggleCount.hidden = false;
        } else {
          navToggleCount.textContent = "";
          navToggleCount.hidden = true;
        }
      }
    }

    function expandAncestors(handle) {
      var activeBtn = hub.querySelector(
        '[data-help-nav-select][data-node-handle="' + String(handle).replace(/"/g, "") + '"]',
      );
      if (!activeBtn) return;
      var node = activeBtn.closest("[data-nav-node]");
      while (node) {
        node.classList.add("is-expanded");
        var children = directChildByClass(node, "help-nav-node__children");
        var row = directChildByClass(node, "help-nav-node__row");
        var toggle = row && row.querySelector("[data-help-nav-toggle]");
        if (children) children.hidden = false;
        if (toggle) toggle.setAttribute("aria-expanded", "true");
        var parent = node.parentElement && node.parentElement.closest("[data-nav-node]");
        node = parent;
      }
    }

    function renderBrowse(page) {
      state.mode = "browse";
      state.page = page || 1;
      state.query = "";
      if (input) input.value = "";

      var articles = articlesForNode(browseData, state.node);
      var total = articles.length;
      var totalPages = Math.max(1, Math.ceil(total / limit));
      if (state.page > totalPages) state.page = totalPages;
      var start = (state.page - 1) * limit;
      var pageItems = articles.slice(start, start + limit);

      if (countEl) countEl.hidden = false;
      if (countNum) countNum.textContent = String(total);
      if (countSuffix) countSuffix.textContent = "articles";

      if (!listEl) return;
      if (total === 0) {
        listEl.innerHTML = '<p class="help-center-hub__empty">No articles in this category yet.</p>';
      } else {
        listEl.innerHTML = pageItems.map(renderBrowseCard).join("");
      }

      renderPagination(paginationEl, state.page, totalPages, function (p) {
        renderBrowse(p);
        window.scrollTo({ top: hub.offsetTop, behavior: "smooth" });
      });

      setActiveNav(state.node, total);
      expandAncestors(state.node);
      syncUrl();
    }

    function runSearch(query, page) {
      if (!query.trim()) {
        state.node = "all";
        renderBrowse(1);
        return;
      }
      state.mode = "search";
      state.query = query;
      state.page = page || 1;
      if (navToggleCount) navToggleCount.hidden = true;
      if (listEl) listEl.innerHTML = '<p class="help-center-hub__loading">Searching…</p>';
      var url =
        proxyBase +
        "?q=" +
        encodeURIComponent(query) +
        "&page=" +
        state.page +
        "&limit=" +
        limit;
      fetch(url)
        .then(function (res) {
          return res.json();
        })
        .then(function (data) {
          if (countEl) countEl.hidden = false;
          if (countNum) countNum.textContent = String(data.total || 0);
          if (countSuffix) countSuffix.textContent = "results";
          if (!listEl) return;
          if (!data.results || data.results.length === 0) {
            listEl.innerHTML = '<p class="help-center-hub__empty">No results found.</p>';
          } else {
            // 用后端回显的 query 高亮,保证与实际命中的关键词一致
            var matched = data.query || query;
            listEl.innerHTML = data.results
              .map(function (hit) {
                return renderSearchCard(hit, matched);
              })
              .join("");
          }
          renderPagination(paginationEl, data.page || 1, data.totalPages || 0, function (p) {
            runSearch(query, p);
            window.scrollTo({ top: hub.offsetTop, behavior: "smooth" });
          });
          syncUrl();
        })
        .catch(function () {
          if (listEl) {
            listEl.innerHTML =
              '<p class="help-center-hub__empty">Search is temporarily unavailable.</p>';
          }
        });
    }

    // Expand / collapse children
    hub.querySelectorAll("[data-help-nav-toggle]").forEach(function (btn) {
      btn.addEventListener("click", function (e) {
        e.preventDefault();
        e.stopPropagation();
        var node = btn.closest("[data-nav-node]");
        if (!node) return;
        var children = directChildByClass(node, "help-nav-node__children");
        var open = !node.classList.contains("is-expanded");
        node.classList.toggle("is-expanded", open);
        if (children) children.hidden = !open;
        btn.setAttribute("aria-expanded", open ? "true" : "false");
      });
    });

    // Select node → refresh list without page reload
    hub.querySelectorAll("[data-help-nav-select]").forEach(function (btn) {
      btn.addEventListener("click", function (e) {
        e.preventDefault();
        var handle = btn.getAttribute("data-node-handle") || "all";
        var node = btn.closest("[data-nav-node]");
        // Parent with children: also expand when selecting
        if (node) {
          var children = directChildByClass(node, "help-nav-node__children");
          if (children) {
            node.classList.add("is-expanded");
            children.hidden = false;
            var row = directChildByClass(node, "help-nav-node__row");
            var toggle = row && row.querySelector("[data-help-nav-toggle]");
            if (toggle) toggle.setAttribute("aria-expanded", "true");
          }
        }
        state.node = handle;
        renderBrowse(1);
        if (window.matchMedia("(max-width: 1023px)").matches) closeNav();
      });
    });

    if (form && input) {
      form.addEventListener("submit", function (e) {
        e.preventDefault();
        var q = input.value.trim();
        if (q) runSearch(q, 1);
        else {
          state.node = "all";
          renderBrowse(1);
        }
      });
    }

    if (bootstrap.query) {
      runSearch(bootstrap.query, bootstrap.page || 1);
    } else {
      // 按 Admin 树序重绘(与侧栏 sort_order / 节点内 articles 顺序一致)
      renderBrowse(state.page || 1);
    }
  }

  function slugify(text) {
    return text
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9\s-]/g, "")
      .replace(/\s+/g, "-")
      .replace(/-+/g, "-");
  }

  function initScrollSpy(headings, links) {
    if (!headings.length || !links.length) return;

    var scrollLocked = false;
    var lockTimer = null;
    var offset = SCROLL_SPY_OFFSET;
    var articleEl = document.querySelector("[data-help-article]");
    if (articleEl && articleEl.getAttribute("data-scroll-offset")) {
      offset = Number(articleEl.getAttribute("data-scroll-offset"));
    }

    function setActive(id) {
      links.forEach(function (link) {
        var match = link.getAttribute("href") === "#" + id;
        link.classList.toggle("is-active", match);
        if (match) link.setAttribute("aria-current", "true");
        else link.removeAttribute("aria-current");
      });
    }

    function updateActive() {
      if (scrollLocked) return;
      var current = headings[0];
      headings.forEach(function (heading) {
        if (heading.getBoundingClientRect().top - offset <= 0) {
          current = heading;
        }
      });
      if (current) setActive(current.id);
    }

    var ticking = false;
    window.addEventListener(
      "scroll",
      function () {
        if (!ticking) {
          requestAnimationFrame(function () {
            updateActive();
            ticking = false;
          });
          ticking = true;
        }
      },
      { passive: true },
    );

    updateActive();

    return {
      lock: function (id) {
        scrollLocked = true;
        clearTimeout(lockTimer);
        setActive(id);
        lockTimer = setTimeout(function () {
          scrollLocked = false;
        }, SCROLL_LOCK_MS);
      },
    };
  }

  function initArticle(article) {
    var content = article.querySelector("[data-help-content]");
    var toc = article.querySelector("[data-help-toc]");
    var tocToggle = article.querySelector("[data-help-toc-toggle]");
    var tocPanel = article.querySelector("[data-help-toc-panel]");
    var headings = [];
    var links = [];

    if (content && toc) {
      headings = Array.prototype.slice.call(content.querySelectorAll("h2, h3"));
      var used = {};
      headings.forEach(function (heading, index) {
        var base = slugify(heading.textContent || "section-" + index) || "section-" + index;
        var id = base;
        var n = 1;
        while (used[id]) {
          n += 1;
          id = base + "-" + n;
        }
        used[id] = true;
        heading.id = id;
        var link = document.createElement("a");
        link.href = "#" + id;
        link.textContent = heading.textContent;
        link.className = heading.tagName === "H3" ? "toc-h3" : "toc-h2";
        toc.appendChild(link);
        links.push(link);
      });

      var spy = initScrollSpy(headings, links);
      links.forEach(function (link) {
        link.addEventListener("click", function (e) {
          e.preventDefault();
          var id = link.getAttribute("href").slice(1);
          var target = document.getElementById(id);
          if (!target) return;
          spy.lock(id);
          target.scrollIntoView({ behavior: "smooth", block: "start" });
          if (tocPanel && window.matchMedia("(max-width: 1023px)").matches) {
            tocPanel.classList.remove("is-open");
            if (tocToggle) tocToggle.setAttribute("aria-expanded", "false");
          }
        });
      });
    }

    if (tocToggle && tocPanel) {
      tocToggle.addEventListener("click", function () {
        var open = tocPanel.classList.toggle("is-open");
        tocToggle.setAttribute("aria-expanded", open ? "true" : "false");
      });
    }

    var feedback = article.querySelector("[data-help-feedback]");
    if (!feedback) return;
    var thanks = article.querySelector("[data-help-feedback-thanks]");
    var proxy = article.getAttribute("data-proxy-feedback") || "/apps/help/feedback";
    var handle = article.getAttribute("data-page-handle");

    feedback.querySelectorAll("[data-helpful]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        fetch(proxy, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            handle: handle,
            helpful: btn.getAttribute("data-helpful") === "true",
          }),
        }).catch(function () {});
        feedback.querySelectorAll("button").forEach(function (b) {
          b.disabled = true;
        });
        if (thanks) thanks.hidden = false;
      });
    });
  }

  document.addEventListener("DOMContentLoaded", function () {
    document.querySelectorAll("[data-help-hub]").forEach(initHub);
    document.querySelectorAll("[data-help-article]").forEach(initArticle);
  });
})();
