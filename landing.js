(() => {
  const CONFIG = {
    url: "https://tgszdvvitdijzkkbrlpl.supabase.co",
    key: "sb_publishable_6GE5AFuO7AH1Ym7GU5qjoA_iUAoFAI2"
  };

  const feed = document.getElementById("publicNewsFeed");
  const state = document.getElementById("publicNewsState");
  if (!feed) return;

  const esc = value => String(value ?? "")
    .replaceAll("&","&amp;")
    .replaceAll("<","&lt;")
    .replaceAll(">","&gt;")
    .replaceAll('"',"&quot;")
    .replaceAll("'","&#039;");

  function plainText(post) {
    if (Array.isArray(post?.content_sections)) {
      const text = post.content_sections
        .filter(section => section && section.type !== "header")
        .map(section => String(section.text || "").trim())
        .filter(Boolean)
        .join("\n\n");
      if (text) return text;
    }
    return String(post?.body || "").trim();
  }

  function excerpt(value, max = 360) {
    const clean = String(value || "").replace(/\s+/g, " ").trim();
    if (clean.length <= max) return clean;
    return clean.slice(0, max).replace(/\s+\S*$/, "") + "…";
  }

  function dateLabel(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "RECENT UPDATE";
    return date.toLocaleDateString(undefined, {
      month: "long",
      day: "numeric",
      year: "numeric"
    }).toUpperCase();
  }

  async function loadNews() {
    state.textContent = "LOADING PUBLIC BULLETINS...";
    try {
      const url = CONFIG.url + "/rest/v1/game_news" +
        "?select=id,title,body,content_sections,published_at,updated_at" +
        "&visibility=eq.public&order=published_at.desc&limit=3";

      const response = await fetch(url, {
        headers: {
          apikey: CONFIG.key
        }
      });

      if (!response.ok) throw new Error("HTTP " + response.status);
      const posts = await response.json();

      if (!Array.isArray(posts) || !posts.length) {
        feed.innerHTML = '<div class="public-news-empty">NO PUBLIC BULLETINS HAVE BEEN PUBLISHED YET.</div>';
        state.textContent = "";
        return;
      }

      const [latest, ...recent] = posts;
      const latestText = excerpt(plainText(latest), 420);

      feed.innerHTML =
        '<article class="public-news-primary">' +
          '<div class="public-news-date">' + esc(dateLabel(latest.published_at)) + '</div>' +
          '<h2>' + esc(latest.title || "Untitled Update") + '</h2>' +
          (latestText ? '<p>' + esc(latestText) + '</p>' : '') +
        '</article>' +
        (recent.length
          ? '<div class="public-news-recent"><div class="public-news-recent-label">RECENT BULLETINS</div>' +
            recent.map(post =>
              '<article>' +
                '<time datetime="' + esc(post.published_at || "") + '">' + esc(dateLabel(post.published_at)) + '</time>' +
                '<strong>' + esc(post.title || "Untitled Update") + '</strong>' +
              '</article>'
            ).join("") +
          '</div>'
          : '');

      state.textContent = "";
    } catch (error) {
      feed.innerHTML = '<div class="public-news-empty">LATEST BULLETINS ARE TEMPORARILY UNAVAILABLE.</div>';
      state.textContent = "";
    }
  }

  loadNews();
})();