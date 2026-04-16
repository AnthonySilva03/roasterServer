const coffeeOriginCatalog = [
    { key: "brazil", label: "Brazil", lat: -18.1, lng: -47.9, aliases: ["brazil", "sul de minas", "cerrado", "mogiana", "bahia", "minas gerais"] },
    { key: "colombia", label: "Colombia", lat: 2.6, lng: -76.6, aliases: ["colombia", "huila", "narino", "nariño", "tolima", "cauca", "antioquia", "medellin"] },
    { key: "costa_rica", label: "Costa Rica", lat: 9.6, lng: -84.2, aliases: ["costa rica", "tarrazu", "tarrazú", "tres rios", "tres ríos", "west valley", "central valley", "brunca"] },
    { key: "guatemala", label: "Guatemala", lat: 15.3, lng: -91.5, aliases: ["guatemala", "huehuetenango", "antigua", "atitlan", "atitlán", "coban", "cobán", "fraijanes"] },
    { key: "honduras", label: "Honduras", lat: 14.9, lng: -88.0, aliases: ["honduras", "copan", "copán", "comayagua", "el paraiso", "el paraíso", "santa barbara", "santa bárbara"] },
    { key: "nicaragua", label: "Nicaragua", lat: 13.1, lng: -85.9, aliases: ["nicaragua", "jinotega", "matagalpa", "nueva segovia"] },
    { key: "mexico", label: "Mexico", lat: 16.8, lng: -92.6, aliases: ["mexico", "méxico", "chiapas", "oaxaca", "veracruz", "puebla"] },
    { key: "peru", label: "Peru", lat: -6.2, lng: -77.9, aliases: ["peru", "perú", "cajamarca", "cusco", "amazonas", "junin", "junín"] },
    { key: "panama", label: "Panama", lat: 8.8, lng: -82.4, aliases: ["panama", "panamá", "boquete", "volcan", "volcán", "baru", "geisha", "gesha"] },
    { key: "ecuador", label: "Ecuador", lat: -3.8, lng: -79.2, aliases: ["ecuador", "loja", "zamora"] },
    { key: "bolivia", label: "Bolivia", lat: -15.6, lng: -67.5, aliases: ["bolivia", "caranavi", "yungas"] },
    { key: "el_salvador", label: "El Salvador", lat: 13.9, lng: -89.7, aliases: ["el salvador", "ahuachapan", "ahuachapán", "santa ana", "apaneca"] },
    { key: "ethiopia", label: "Ethiopia", lat: 6.9, lng: 38.3, aliases: ["ethiopia", "yirgacheffe", "sidamo", "sidama", "guji", "limu", "jimma", "lekempti"] },
    { key: "kenya", label: "Kenya", lat: 0.5, lng: 37.2, aliases: ["kenya", "nyeri", "kirinyaga", "embu", "kiambu"] },
    { key: "rwanda", label: "Rwanda", lat: -2.2, lng: 29.4, aliases: ["rwanda", "kivu", "nyamasheke", "gakenke", "huye"] },
    { key: "burundi", label: "Burundi", lat: -3.3, lng: 29.6, aliases: ["burundi", "kayanza", "ngozi", "muyinga"] },
    { key: "tanzania", label: "Tanzania", lat: -5.7, lng: 37.3, aliases: ["tanzania", "mbeya", "arusha", "kilimanjaro"] },
    { key: "uganda", label: "Uganda", lat: 1.3, lng: 34.3, aliases: ["uganda", "bugisu", "rwenzori", "sipi"] },
    { key: "congo", label: "DR Congo", lat: -2.5, lng: 28.8, aliases: ["congo", "dr congo", "drc", "kivu congo", "democratic republic of congo"] },
    { key: "yemen", label: "Yemen", lat: 15.4, lng: 44.4, aliases: ["yemen", "mattari", "harazi", "sana'a", "sanaa"] },
    { key: "india", label: "India", lat: 13.3, lng: 75.7, aliases: ["india", "bababudangiri", "karnataka", "malabar", "coorg"] },
    { key: "vietnam", label: "Vietnam", lat: 12.0, lng: 108.4, aliases: ["vietnam", "da lat", "dalat", "lam dong", "dak lak"] },
    { key: "indonesia", label: "Indonesia", lat: -0.8, lng: 100.8, aliases: ["indonesia", "sumatra", "aceh", "mandheling", "lintong", "java", "flores", "sulawesi", "toraja", "bali"] },
    { key: "papua_new_guinea", label: "Papua New Guinea", lat: -6.3, lng: 145.6, aliases: ["papua new guinea", "png", "eastern highlands", "western highlands"] },
    { key: "china", label: "China", lat: 24.7, lng: 101.5, aliases: ["china", "yunnan", "pu'er", "puer"] },
    { key: "hawaii", label: "Hawaii", lat: 19.6, lng: -155.8, aliases: ["hawaii", "kona"] },
    { key: "jamaica", label: "Jamaica", lat: 18.1, lng: -76.6, aliases: ["jamaica", "blue mountain", "blue mountains"] },
];

function normalizeOriginText(origin) {
    return String(origin || "")
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, " ")
        .trim();
}

function resolveOriginLocation(origin) {
    const normalizedOrigin = normalizeOriginText(origin);
    if (!normalizedOrigin) {
        return null;
    }

    let bestMatch = null;

    coffeeOriginCatalog.forEach((entry) => {
        entry.aliases.forEach((alias) => {
            const normalizedAlias = normalizeOriginText(alias);
            if (!normalizedAlias || !normalizedOrigin.includes(normalizedAlias)) {
                return;
            }

            if (!bestMatch || normalizedAlias.length > bestMatch.aliasLength) {
                bestMatch = {
                    key: entry.key,
                    label: entry.label,
                    point: { lat: entry.lat, lng: entry.lng },
                    aliasLength: normalizedAlias.length,
                    matchedAlias: alias,
                };
            }
        });
    });

    return bestMatch;
}

function projectOriginCoordinate(point) {
    const left = ((point.lng + 180) / 360) * 100;
    const top = ((90 - point.lat) / 180) * 100;
    return { left, top };
}

function buildMappedOrigins(roasts) {
    const groupedOrigins = (roasts || []).reduce((accumulator, roast) => {
        const resolvedOrigin = resolveOriginLocation(roast.origin);
        if (!resolvedOrigin) {
            return accumulator;
        }

        if (!accumulator[resolvedOrigin.key]) {
            accumulator[resolvedOrigin.key] = {
                key: resolvedOrigin.key,
                label: roast.origin,
                canonicalLabel: resolvedOrigin.label,
                count: 0,
                point: resolvedOrigin.point,
                aliases: [resolvedOrigin.matchedAlias],
                roasts: [],
            };
        }

        accumulator[resolvedOrigin.key].count += 1;
        accumulator[resolvedOrigin.key].roasts.push(roast);
        if (!accumulator[resolvedOrigin.key].aliases.includes(resolvedOrigin.matchedAlias)) {
            accumulator[resolvedOrigin.key].aliases.push(resolvedOrigin.matchedAlias);
        }
        return accumulator;
    }, {});

    return Object.values(groupedOrigins).sort((left, right) => right.count - left.count);
}

function renderOriginMarkers(markersEl, mappedOrigins, selectedOriginKey) {
    markersEl.innerHTML = mappedOrigins.map((origin) => {
        const placement = projectOriginCoordinate(origin.point);
        const markerSize = Math.min(22, 12 + (origin.count - 1) * 2);
        const activeClass = origin.key === selectedOriginKey ? "active" : "";
        return `
            <button
                type="button"
                class="origin-marker ${activeClass}"
                data-origin-key="${origin.key}"
                style="left: ${placement.left}%; top: ${placement.top}%;"
                title="${origin.label} matched to ${origin.canonicalLabel} (${origin.count})"
            >
                <span class="origin-marker-dot" style="width: ${markerSize}px; height: ${markerSize}px;"></span>
                <span class="origin-marker-label">${origin.canonicalLabel}</span>
            </button>
        `;
    }).join("");
}
