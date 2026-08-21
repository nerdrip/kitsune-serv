<?php
declare(strict_types=1);

/**
 * Kitsune Showcase
 * - Lists all first-level folders in /docs with stable/snapshot channels
 * - Repo section with optional GitHub README preview
 * - Bilingual: PL / EN
 */

$baseDir = __DIR__ . DIRECTORY_SEPARATOR . 'docs';
$baseUrl = '/docs';

$siteConfigPath = __DIR__ . DIRECTORY_SEPARATOR . 'showcase.json';
$siteConfig = is_file($siteConfigPath) ? json_decode((string) file_get_contents($siteConfigPath), true) : [];
if (!is_array($siteConfig)) $siteConfig = [];
$repositoriesConfig = isset($siteConfig['openRepositories']) && is_array($siteConfig['openRepositories'])
    ? $siteConfig['openRepositories']
    : [];

function is_safe_segment(string $s): bool {
    return (bool)preg_match('/^[A-Za-z0-9._-]+$/', $s);
}

function prettify_name(string $folder): string {
    $name = preg_replace('/[_-]+/', ' ', $folder);
    $name = preg_replace('/([a-z])([A-Z])/', '$1 $2', $name);
    $name = trim($name ?? $folder);
    return mb_convert_case($name, MB_CASE_TITLE, "UTF-8");
}

function list_dirs(string $path): array {
    if (!is_dir($path)) return [];
    $items = scandir($path);
    if ($items === false) return [];

    $dirs = [];
    foreach ($items as $it) {
        if ($it === '.' || $it === '..') continue;
        if ($it[0] === '.') continue;
        $full = $path . DIRECTORY_SEPARATOR . $it;
        if (is_dir($full) && is_safe_segment($it)) {
            $dirs[] = $it;
        }
    }
    sort($dirs, SORT_NATURAL | SORT_FLAG_CASE);
    return $dirs;
}

function newest_mtime_recursive(string $path, int $limit = 800): int {
    if (!file_exists($path)) return 0;

    $max = @filemtime($path) ?: 0;
    $count = 0;

    $iter = new RecursiveIteratorIterator(
        new RecursiveDirectoryIterator($path, FilesystemIterator::SKIP_DOTS),
        RecursiveIteratorIterator::SELF_FIRST
    );

    foreach ($iter as $file) {
        $count++;
        if ($count > $limit) break;
        $mt = $file->getMTime();
        if ($mt > $max) $max = $mt;
    }
    return $max;
}

function detect_lang(): string {
    if (isset($_GET['lang'])) {
        $lang = strtolower((string)$_GET['lang']);
        if (in_array($lang, ['pl', 'en'], true)) {
            return $lang;
        }
    }

    $accept = $_SERVER['HTTP_ACCEPT_LANGUAGE'] ?? '';
    if (stripos($accept, 'pl') === 0 || stripos($accept, ',pl') !== false) {
        return 'pl';
    }

    return 'en';
}

$lang = detect_lang();

$i18n = [
    'pl' => [
        'title' => 'Kitsune.WEBSITE',
        'tagline' => 'Dokumentacje lisich bibliotek — w jednym, lisim leżu.',
        'eyebrow' => 'OPEN SOURCE · ANDROID · WEB',
        'hero_title' => 'Kod, który rośnie razem ze społecznością.',
        'hero_desc' => 'Jedno miejsce dla stabilnych wydań, świeżych snapshotów, interaktywnych narzędzi i projektów tworzonych pod znakiem Kitsune.',
        'explore_docs' => 'Odkryj biblioteki',
        'explore_repos' => 'Zobacz otwarte projekty',
        'nav_docs' => 'Dokumentacja',
        'nav_repos' => 'Repozytoria',
        'stat_libraries' => 'bibliotek',
        'stat_repositories' => 'otwartych projektów',
        'stat_channels' => 'kanały wydań',
        'live_catalog' => 'Katalog aktualizowany przez KitsuneServ',
        'meta_description' => 'Index dokumentacji z /docs',
        'lang_label' => 'Język',
        'lang_pl' => 'Polski',
        'lang_en' => 'English',
        'special' => 'specjalne',
        'ks_subtitle' => 'Dokumentacja + narzędzia',
        'ks_doc' => 'Dokumentacja',
        'ks_doc_desc' => 'Główne API i opis biblioteki',
        'ks_playground' => 'Playground',
        'ks_playground_desc' => 'Szybkie testy i przykłady',
        'ks_layout' => 'Layout Editor',
        'ks_layout_desc' => 'Edytor układów / narzędzia dev',
        'libraries' => 'Biblioteki',
        'generated_from' => 'Lista wygenerowana z folderów w',
        'ks_missing' => 'Nie znalazłam',
        'ks_missing_suffix' => '— sekcja specjalna się nie pokazała.',
        'empty_title' => 'Brak bibliotek do wyświetlenia',
        'empty_desc' => 'Dodaj foldery do /docs, a pojawią się tutaj automatycznie.',
        'folder' => 'Folder',
        'last_change' => 'Ostatnia zmiana',
        'stable' => 'Stabilna',
        'snapshot' => 'Snapshot',
        'version_unavailable' => 'Niedostępna',
        'choose_version' => 'Wybierz kanał dokumentacji',
        'open_in_new_tab' => 'Otwórz w nowej karcie',

        'repos_title' => 'Repozytoria',
        'repos_subtitle' => 'Podgląd README z GitHuba (branch main / wskazany branch).',
        'repo_open_github' => 'Otwórz repozytorium',
        'repo_readme' => 'README',
        'repo_branch' => 'Branch',
        'repo_updated' => 'Odświeżono',
        'repo_error' => 'Nie udało się pobrać README.',
        'repo_empty' => 'Brak repozytoriów do wyświetlenia.',
        'repo_raw' => 'Surowy plik README',
    ],
    'en' => [
        'title' => 'Kitsune.WEBSITE',
        'tagline' => 'Documentation for fox-flavored libraries — gathered in one cozy den.',
        'eyebrow' => 'OPEN SOURCE · ANDROID · WEB',
        'hero_title' => 'Code that grows with its community.',
        'hero_desc' => 'One home for stable releases, fresh snapshots, interactive tools, and open projects built under the Kitsune banner.',
        'explore_docs' => 'Explore libraries',
        'explore_repos' => 'Browse open projects',
        'nav_docs' => 'Documentation',
        'nav_repos' => 'Repositories',
        'stat_libraries' => 'libraries',
        'stat_repositories' => 'open projects',
        'stat_channels' => 'release channels',
        'live_catalog' => 'Catalog updated by KitsuneServ',
        'meta_description' => 'Documentation index from /docs',
        'lang_label' => 'Language',
        'lang_pl' => 'Polski',
        'lang_en' => 'English',
        'special' => 'special',
        'ks_subtitle' => 'Documentation + tools',
        'ks_doc' => 'Documentation',
        'ks_doc_desc' => 'Main API and library overview',
        'ks_playground' => 'Playground',
        'ks_playground_desc' => 'Quick tests and examples',
        'ks_layout' => 'Layout Editor',
        'ks_layout_desc' => 'Layout editor / developer tools',
        'libraries' => 'Libraries',
        'generated_from' => 'List generated from folders in',
        'ks_missing' => 'I could not find',
        'ks_missing_suffix' => '— the special section was not displayed.',
        'empty_title' => 'No libraries to display',
        'empty_desc' => 'Add folders to /docs and they will appear here automatically.',
        'folder' => 'Folder',
        'last_change' => 'Last updated',
        'stable' => 'Stable',
        'snapshot' => 'Snapshot',
        'version_unavailable' => 'Unavailable',
        'choose_version' => 'Choose a documentation channel',
        'open_in_new_tab' => 'Open in a new tab',

        'repos_title' => 'Repositories',
        'repos_subtitle' => 'README preview from GitHub (main / configured branch).',
        'repo_open_github' => 'Open repository',
        'repo_readme' => 'README',
        'repo_branch' => 'Branch',
        'repo_updated' => 'Refreshed',
        'repo_error' => 'Could not load README.',
        'repo_empty' => 'No repositories to display.',
        'repo_raw' => 'Raw README file',
    ],
];

$t = $i18n[$lang];

function tr(array $t, string $key): string {
    return $t[$key] ?? $key;
}

function fmt_date(int $ts): string {
    if ($ts <= 0) return '—';
    return date('Y-m-d H:i', $ts);
}

function build_lang_url(string $langCode): string {
    $params = $_GET;
    $params['lang'] = $langCode;
    $query = http_build_query($params);
    $path = strtok($_SERVER['REQUEST_URI'] ?? '', '?');
    if ($path === false || $path === '') {
        $path = '';
    }
    return $path . ($query ? '?' . $query : '');
}

function build_query_url(array $extraParams = []): string {
    $params = $_GET;
    foreach ($extraParams as $k => $v) {
        if ($v === null) {
            unset($params[$k]);
        } else {
            $params[$k] = $v;
        }
    }
    $query = http_build_query($params);
    $path = strtok($_SERVER['REQUEST_URI'] ?? '', '?');
    if ($path === false || $path === '') {
        $path = '';
    }
    return $path . ($query ? '?' . $query : '');
}

function slugify(string $value): string {
    $value = strtolower(trim($value));
    $value = preg_replace('/[^a-z0-9]+/', '-', $value);
    $value = trim((string)$value, '-');
    return $value !== '' ? $value : 'repo';
}

function parse_github_repo_url(string $url): ?array {
    $parts = parse_url($url);
    if (!$parts || empty($parts['host']) || strtolower((string) $parts['host']) !== 'github.com') {
        return null;
    }

    $path = trim($parts['path'] ?? '', '/');
    if ($path === '') return null;

    $segments = explode('/', $path);
    if (count($segments) < 2) return null;

    $owner = $segments[0];
    $repo = preg_replace('/\.git$/i', '', $segments[1]);

    if (!is_safe_segment($owner) || !is_safe_segment($repo)) {
        return null;
    }

    return [
        'owner' => $owner,
        'repo' => $repo,
    ];
}

function http_get_text(string $url, int $timeout = 10): ?string {
    if (function_exists('curl_init')) {
        $ch = curl_init($url);
        if ($ch === false) return null;

        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_FOLLOWLOCATION => true,
            CURLOPT_CONNECTTIMEOUT => 5,
            CURLOPT_TIMEOUT => $timeout,
            CURLOPT_USERAGENT => 'KitsuneDocsIndex/1.0',
            CURLOPT_HTTPHEADER => [
                'Accept: text/plain, text/markdown;q=0.9, */*;q=0.8',
            ],
        ]);

        $body = curl_exec($ch);
        $code = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
        curl_close($ch);

        if ($body !== false && $code >= 200 && $code < 300) {
            return (string)$body;
        }
        return null;
    }

    if (ini_get('allow_url_fopen')) {
        $ctx = stream_context_create([
            'http' => [
                'method' => 'GET',
                'timeout' => $timeout,
                'header' => "User-Agent: KitsuneDocsIndex/1.0\r\nAccept: text/plain, text/markdown;q=0.9, */*;q=0.8\r\n",
            ],
        ]);
        $body = @file_get_contents($url, false, $ctx);
        if ($body !== false) {
            return (string)$body;
        }
    }

    return null;
}

function cache_dir_path(): string {
    return rtrim(sys_get_temp_dir(), DIRECTORY_SEPARATOR) . DIRECTORY_SEPARATOR . 'kitsune-showcase-' . substr(hash('sha256', __DIR__), 0, 16) . DIRECTORY_SEPARATOR . 'repo-readmes';
}

function ensure_cache_dir(): void {
    $dir = cache_dir_path();
    if (!is_dir($dir)) {
        @mkdir($dir, 0775, true);
    }
}

function repo_cache_file(string $slug): string {
    return cache_dir_path() . DIRECTORY_SEPARATOR . $slug . '.json';
}

function load_repo_cache(string $slug, int $ttl = 900): ?array {
    $file = repo_cache_file($slug);
    if (!is_file($file)) return null;
    if ((time() - (int)@filemtime($file)) > $ttl) return null;

    $json = @file_get_contents($file);
    if ($json === false) return null;

    $data = json_decode($json, true);
    return is_array($data) ? $data : null;
}

function save_repo_cache(string $slug, array $data): void {
    ensure_cache_dir();
    @file_put_contents(repo_cache_file($slug), json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_PRETTY_PRINT));
}

function github_readme_candidate_urls(string $owner, string $repo, string $branch): array {
    $names = ['README.md', 'readme.md', 'README.MD', 'Readme.md'];
    $urls = [];
    foreach ($names as $name) {
        $urls[] = "https://raw.githubusercontent.com/{$owner}/{$repo}/{$branch}/{$name}";
    }
    return $urls;
}

function fetch_github_readme(array $repoInfo, string $branch = 'main'): array {
    $owner = $repoInfo['owner'];
    $repo = $repoInfo['repo'];

    $branchesToTry = array_values(array_unique([$branch, 'main', 'master']));
    foreach ($branchesToTry as $branchName) {
        foreach (github_readme_candidate_urls($owner, $repo, $branchName) as $rawUrl) {
            $content = http_get_text($rawUrl, 12);
            if ($content !== null && trim($content) !== '') {
                return [
                    'ok' => true,
                    'content' => $content,
                    'raw_url' => $rawUrl,
                    'branch' => $branchName,
                    'fetched_at' => time(),
                ];
            }
        }
    }

    return [
        'ok' => false,
        'content' => null,
        'raw_url' => null,
        'branch' => $branch,
        'fetched_at' => time(),
    ];
}

function inline_markdown_to_html(string $text): string {
    $text = htmlspecialchars($text, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');

    $codeStore = [];
    $text = preg_replace_callback('/`([^`\n]+)`/', function($m) use (&$codeStore) {
        $key = '__CODE_' . count($codeStore) . '__';
        $codeStore[$key] = '<code>' . $m[1] . '</code>';
        return $key;
    }, $text);

    $text = preg_replace('~\[(.*?)\]\((https?://[^\s\)]+)\)~', '<a href="$2" target="_blank" rel="noopener">$1</a>', $text);
    $text = preg_replace('~\*\*(.+?)\*\*~s', '<strong>$1</strong>', $text);
    $text = preg_replace('~__(.+?)__~s', '<strong>$1</strong>', $text);
    $text = preg_replace('~(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)~s', '<em>$1</em>', $text);
    $text = preg_replace('~(?<!_)_(?!_)(.+?)(?<!_)_(?!_)~s', '<em>$1</em>', $text);

    foreach ($codeStore as $key => $html) {
        $text = str_replace($key, $html, $text);
    }

    return $text;
}

function markdown_table_to_html(array $lines): string {
    $rows = [];
    foreach ($lines as $line) {
        $trim = trim($line);
        $trim = trim($trim, '|');
        $cells = array_map('trim', explode('|', $trim));
        $rows[] = $cells;
    }

    if (count($rows) < 2) {
        return '<p>' . inline_markdown_to_html(implode("\n", $lines)) . '</p>';
    }

    $header = $rows[0];
    $alignLine = $rows[1];
    $bodyRows = array_slice($rows, 2);

    $isDivider = true;
    foreach ($alignLine as $cell) {
        if (!preg_match('/^:?-{3,}:?$/', trim($cell))) {
            $isDivider = false;
            break;
        }
    }

    if (!$isDivider) {
        return '<p>' . inline_markdown_to_html(implode("\n", $lines)) . '</p>';
    }

    $html = '<div class="md-table-wrap"><table class="md-table"><thead><tr>';
    foreach ($header as $cell) {
        $html .= '<th>' . inline_markdown_to_html($cell) . '</th>';
    }
    $html .= '</tr></thead>';

    if ($bodyRows) {
        $html .= '<tbody>';
        foreach ($bodyRows as $row) {
            $html .= '<tr>';
            foreach ($row as $cell) {
                $html .= '<td>' . inline_markdown_to_html($cell) . '</td>';
            }
            $html .= '</tr>';
        }
        $html .= '</tbody>';
    }

    $html .= '</table></div>';
    return $html;
}

function markdown_to_html(string $markdown): string {
    $markdown = str_replace(["\r\n", "\r"], "\n", $markdown);
    $lines = explode("\n", $markdown);

    $html = [];
    $paragraph = [];
    $listItems = [];
    $blockquote = [];
    $codeBlock = [];
    $codeLang = '';
    $inCode = false;
    $tableBuffer = [];

    $flushParagraph = function() use (&$html, &$paragraph) {
        if (!$paragraph) return;
        $text = trim(implode(' ', $paragraph));
        if ($text !== '') {
            $html[] = '<p>' . inline_markdown_to_html($text) . '</p>';
        }
        $paragraph = [];
    };

    $flushList = function() use (&$html, &$listItems) {
        if (!$listItems) return;
        $html[] = '<ul><li>' . implode('</li><li>', array_map(fn($x) => inline_markdown_to_html($x), $listItems)) . '</li></ul>';
        $listItems = [];
    };

    $flushQuote = function() use (&$html, &$blockquote) {
        if (!$blockquote) return;
        $joined = trim(implode("\n", $blockquote));
        $html[] = '<blockquote>' . markdown_to_html($joined) . '</blockquote>';
        $blockquote = [];
    };

    $flushTable = function() use (&$html, &$tableBuffer) {
        if (!$tableBuffer) return;
        $html[] = markdown_table_to_html($tableBuffer);
        $tableBuffer = [];
    };

    foreach ($lines as $line) {
        if (preg_match('/^```([\w+-]*)\s*$/', $line, $m)) {
            $flushParagraph();
            $flushList();
            $flushQuote();
            $flushTable();

            if (!$inCode) {
                $inCode = true;
                $codeBlock = [];
                $codeLang = trim($m[1] ?? '');
            } else {
                $class = $codeLang !== '' ? ' class="language-' . htmlspecialchars($codeLang, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8') . '"' : '';
                $html[] = '<pre><code' . $class . '>' . htmlspecialchars(implode("\n", $codeBlock), ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8') . '</code></pre>';
                $inCode = false;
                $codeBlock = [];
                $codeLang = '';
            }
            continue;
        }

        if ($inCode) {
            $codeBlock[] = $line;
            continue;
        }

        if (preg_match('/^\s*\|.+\|\s*$/', $line)) {
            $flushParagraph();
            $flushList();
            $flushQuote();
            $tableBuffer[] = $line;
            continue;
        } else {
            $flushTable();
        }

        if (trim($line) === '') {
            $flushParagraph();
            $flushList();
            $flushQuote();
            continue;
        }

        if (preg_match('/^(#{1,6})\s+(.*)$/', $line, $m)) {
            $flushParagraph();
            $flushList();
            $flushQuote();
            $level = min(6, strlen($m[1]));
            $html[] = '<h' . $level . '>' . inline_markdown_to_html(trim($m[2])) . '</h' . $level . '>';
            continue;
        }

        if (preg_match('/^\s*[-*+]\s+(.*)$/', $line, $m)) {
            $flushParagraph();
            $flushQuote();
            $listItems[] = trim($m[1]);
            continue;
        }

        if (preg_match('/^\s*>\s?(.*)$/', $line, $m)) {
            $flushParagraph();
            $flushList();
            $blockquote[] = $m[1];
            continue;
        }

        if (preg_match('/^\s*---+\s*$/', $line) || preg_match('/^\s*\*\*\*+\s*$/', $line)) {
            $flushParagraph();
            $flushList();
            $flushQuote();
            $html[] = '<hr>';
            continue;
        }

        $paragraph[] = trim($line);
    }

    $flushParagraph();
    $flushList();
    $flushQuote();
    $flushTable();

    if ($inCode) {
        $class = $codeLang !== '' ? ' class="language-' . htmlspecialchars($codeLang, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8') . '"' : '';
        $html[] = '<pre><code' . $class . '>' . htmlspecialchars(implode("\n", $codeBlock), ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8') . '</code></pre>';
    }

    return implode("\n", $html);
}

function build_repositories(array $repositoriesConfig, string $lang): array {
    $repos = [];

    foreach ($repositoriesConfig as $repoCfg) {
        $url = trim((string)($repoCfg['url'] ?? ''));
        if ($url === '') continue;

        $parsed = parse_github_repo_url($url);

        $label = trim((string)($repoCfg['label'] ?? ''));
        if ($label === '') {
            $label = $parsed ? $parsed['repo'] : $url;
        }

        $slug = slugify((string)($repoCfg['slug'] ?? $label));
        $branch = trim((string)($repoCfg['branch'] ?? 'main'));
        $desc = '';
        if (isset($repoCfg['description']) && is_array($repoCfg['description'])) {
            $desc = (string)($repoCfg['description'][$lang] ?? $repoCfg['description']['en'] ?? '');
        } else {
            $desc = (string)($repoCfg['description'] ?? '');
        }

        $cached = $parsed ? load_repo_cache($slug) : null;
        if ($parsed && !$cached) {
            $fetched = fetch_github_readme($parsed, $branch);
            $cached = [
                'ok' => $fetched['ok'],
                'content' => $fetched['content'],
                'raw_url' => $fetched['raw_url'],
                'branch' => $fetched['branch'],
                'fetched_at' => $fetched['fetched_at'],
            ];
            save_repo_cache($slug, $cached);
        }

        if (!$cached) $cached = ['ok' => false, 'content' => '', 'raw_url' => null, 'branch' => $branch, 'fetched_at' => 0];
        $repos[] = [
            'slug' => $slug,
            'label' => $label,
            'description' => $desc,
            'github_url' => $url,
            'owner' => $parsed['owner'] ?? '',
            'repo' => $parsed['repo'] ?? $label,
            'branch' => (string)($cached['branch'] ?? $branch),
            'raw_url' => $cached['raw_url'] ?? null,
            'ok' => (bool)($cached['ok'] ?? false),
            'readme_markdown' => (string)($cached['content'] ?? ''),
            'readme_html' => !empty($cached['content']) ? markdown_to_html((string)$cached['content']) : '',
            'fetched_at' => (int)($cached['fetched_at'] ?? 0),
        ];
    }

    return $repos;
}

$projects = list_dirs($baseDir);
$libraryLabels = [];
$libraryMetadata = [];
foreach ((array) ($siteConfig['libraries'] ?? []) as $library) {
    if (!is_array($library) || !isset($library['slug'])) continue;
    $slug = (string) $library['slug'];
    if (isset($library['label'])) $libraryLabels[$slug] = (string) $library['label'];
    $libraryMetadata[$slug] = $library;
}

// Build data for generic projects
$cards = [];
foreach ($projects as $p) {
    $path = $baseDir . DIRECTORY_SEPARATOR . $p;
    $stablePath = $path . DIRECTORY_SEPARATOR . 'stable';
    $snapshotPath = $path . DIRECTORY_SEPARATOR . 'snapshot';
    $stable = is_file($stablePath . DIRECTORY_SEPARATOR . 'index.html');
    $snapshot = is_file($snapshotPath . DIRECTORY_SEPARATOR . 'index.html');
    if (!$stable && !$snapshot) continue;
    $versions = is_array($libraryMetadata[$p]['versions'] ?? null) ? $libraryMetadata[$p]['versions'] : [];
    $stableVersion = trim((string) ($versions['stable']['version'] ?? ''));
    $snapshotVersion = trim((string) ($versions['snapshot']['version'] ?? ''));
    if ($snapshotVersion !== '' && !preg_match('/-SNAPSHOT$/i', $snapshotVersion)) $snapshotVersion .= '-SNAPSHOT';
    $tools = [];
    if (preg_replace('/[^a-z0-9]/', '', strtolower($p)) === 'kitsunescript') {
        foreach ([
            ['slug' => 'playground', 'label_key' => 'ks_playground', 'description_key' => 'ks_playground_desc'],
            ['slug' => 'layout-editor', 'label_key' => 'ks_layout', 'description_key' => 'ks_layout_desc'],
        ] as $tool) {
            $tool['stable_url'] = is_file($stablePath . DIRECTORY_SEPARATOR . $tool['slug'] . DIRECTORY_SEPARATOR . 'index.html')
                ? $baseUrl . '/' . rawurlencode($p) . '/stable/' . rawurlencode($tool['slug']) . '/'
                : null;
            $tool['snapshot_url'] = is_file($snapshotPath . DIRECTORY_SEPARATOR . $tool['slug'] . DIRECTORY_SEPARATOR . 'index.html')
                ? $baseUrl . '/' . rawurlencode($p) . '/snapshot/' . rawurlencode($tool['slug']) . '/'
                : null;
            if ($tool['stable_url'] || $tool['snapshot_url']) $tools[] = $tool;
        }
    }
    $mtime = max(newest_mtime_recursive($stablePath), newest_mtime_recursive($snapshotPath));
    $cards[] = [
        'folder' => $p,
        'title'  => $libraryLabels[$p] ?? prettify_name($p),
        'stable_url' => $stable ? $baseUrl . '/' . rawurlencode($p) . '/stable/' : null,
        'snapshot_url' => $snapshot ? $baseUrl . '/' . rawurlencode($p) . '/snapshot/' : null,
        'stable_version' => $stableVersion,
        'snapshot_version' => $snapshotVersion,
        'tools' => $tools,
        'mtime'  => $mtime,
    ];
}

// Sort generic cards by last updated (desc), then title
usort($cards, function($a, $b) {
    if ($a['mtime'] === $b['mtime']) return strcasecmp($a['title'], $b['title']);
    return $b['mtime'] <=> $a['mtime'];
});

$repositories = build_repositories($repositoriesConfig, $lang);
$activeRepoSlug = isset($_GET['repo']) ? slugify((string)$_GET['repo']) : ($repositories[0]['slug'] ?? '');
$activeRepo = null;
foreach ($repositories as $repo) {
    if ($repo['slug'] === $activeRepoSlug) {
        $activeRepo = $repo;
        break;
    }
}
if (!$activeRepo && !empty($repositories)) {
    $activeRepo = $repositories[0];
}

$title = tr($t, 'title');
$tagline = tr($t, 'tagline');
$publishedLibraryCount = count($cards);
$openRepositoryCount = count($repositories);
?>
<!doctype html>
<html lang="<?= htmlspecialchars($lang) ?>">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title><?= htmlspecialchars($title) ?></title>
  <meta name="description" content="<?= htmlspecialchars(tr($t, 'meta_description')) ?>">
  <style>
    :root{
      --bg0:#070711;
      --bg1:#0b0b18;
      --card:#0f1022cc;
      --card2:#141634cc;
      --line:#252857;
      --text:#e9e9ff;
      --muted:#b7b8e6;
      --glow:#ff6a3d;
      --glow2:#7c5cff;
      --ok:#55ffa7;
      --shadow: 0 12px 40px rgba(0,0,0,.45);
      --radius: 18px;
      --radius2: 26px;
    }
    *{box-sizing:border-box}
    html{scroll-behavior:smooth}
    html,body{height:100%}
	body{
	  margin:0;
	  color:var(--text);
	  font: 15px/1.5 system-ui, -apple-system, Segoe UI, Roboto, Ubuntu, Cantarell, "Helvetica Neue", Arial, "Noto Sans", "Apple Color Emoji","Segoe UI Emoji";
	  background: transparent;
	  overflow-x:hidden;
	}

    body:after{
      content:"";
      position:fixed;inset:0;z-index:-1;pointer-events:none;opacity:.16;
      background-image:url("data:image/svg+xml,%3Csvg viewBox='0 0 180 180' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.8' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='.22'/%3E%3C/svg%3E");
      mix-blend-mode:soft-light;
    }

	body::before{
	  content:"";
	  position:fixed;
	  inset:0;
	  z-index:-1;
	  pointer-events:none;
	  background:
		radial-gradient(900px 450px at 12% 10%, rgba(255,106,61,.22), transparent 60%),
		radial-gradient(700px 380px at 88% 14%, rgba(124,92,255,.25), transparent 60%),
		radial-gradient(900px 520px at 55% 95%, rgba(255,106,61,.12), transparent 60%),
		linear-gradient(180deg, var(--bg0), var(--bg1));
	  background-repeat:no-repeat;
	  background-size:cover;
	}
    .wrap{max-width:1240px;margin:0 auto;padding:24px 18px 70px}
    header{
      display:flex; gap:18px; align-items:center; justify-content:space-between;
      padding:22px 20px;
      border:1px solid rgba(255,255,255,.08);
      border-radius: var(--radius2);
      background: linear-gradient(180deg, rgba(255,255,255,.06), rgba(255,255,255,.03));
      box-shadow: var(--shadow);
      position:relative;
      overflow:hidden;
      backdrop-filter:blur(22px) saturate(130%);
    }
    header:before{
      content:"";
      position:absolute; inset:-2px;
      background:
        radial-gradient(380px 220px at 0% 0%, rgba(255,106,61,.18), transparent 60%),
        radial-gradient(380px 220px at 100% 0%, rgba(124,92,255,.18), transparent 60%);
      pointer-events:none;
    }
    .brand{position:relative; display:flex; gap:14px; align-items:center}
    .logo{
      width:44px;height:44px;border-radius:14px;
      background: radial-gradient(18px 18px at 28% 28%, rgba(255,255,255,.35), transparent 55%),
                  linear-gradient(135deg, rgba(255,106,61,.95), rgba(124,92,255,.95));
      box-shadow: 0 0 0 1px rgba(255,255,255,.10), 0 12px 30px rgba(255,106,61,.15);
      position:relative;
    }
    .logo:after{
      content:"🦊";
      position:absolute; inset:10px 12px;
      border-radius: 10px 10px 16px 16px;
      background: rgba(10,10,22,.55);
      transform: rotate(10deg);
      filter: blur(.2px);
      display:flex;
      align-items:center;
      justify-content:center;
      font-size:18px;
    }
    h1{margin:0;font-size:18px;letter-spacing:.3px}
    .tag{margin:2px 0 0;color:var(--muted);font-size:13px}
    .right{
      position:relative;
      display:flex;
      gap:10px;
      align-items:center;
      flex-wrap:wrap;
      z-index:2;
    }
    .lang-switch{
      display:flex;
      align-items:center;
      gap:8px;
      padding:6px;
      border-radius:999px;
      border:1px solid rgba(255,255,255,.10);
      background: rgba(0,0,0,.22);
      backdrop-filter: blur(8px);
    }
    .top-nav{display:flex;gap:6px;align-items:center}
    .top-nav a{color:var(--muted);text-decoration:none;font-size:12px;font-weight:700;padding:10px 12px;border-radius:999px;transition:.2s ease}
    .top-nav a:hover{color:#fff;background:rgba(255,255,255,.06)}
    .hero{
      position:relative;isolation:isolate;overflow:hidden;margin-top:18px;padding:74px 52px 52px;
      border:1px solid rgba(255,255,255,.09);border-radius:34px;
      background:linear-gradient(135deg,rgba(255,106,61,.10),rgba(15,16,34,.88) 42%,rgba(124,92,255,.14));
      box-shadow:0 30px 90px rgba(0,0,0,.5);
    }
    .hero:before,.hero:after{content:"";position:absolute;border-radius:50%;filter:blur(4px);z-index:-1;animation:drift 12s ease-in-out infinite alternate}
    .hero:before{width:420px;height:420px;right:-100px;top:-180px;background:radial-gradient(circle,rgba(124,92,255,.38),transparent 68%)}
    .hero:after{width:360px;height:360px;left:-150px;bottom:-210px;background:radial-gradient(circle,rgba(255,106,61,.32),transparent 68%);animation-delay:-5s}
    @keyframes drift{to{transform:translate3d(28px,18px,0) scale(1.08)}}
    .hero-copy{max-width:820px}
    .eyebrow{display:inline-flex;align-items:center;gap:9px;margin:0 0 18px;color:#ffd2c5;font-size:11px;font-weight:800;letter-spacing:.2em}
    .eyebrow:before{content:"";width:30px;height:1px;background:linear-gradient(90deg,var(--glow),var(--glow2))}
    .hero h2{margin:0;max-width:900px;font-size:clamp(42px,7vw,86px);line-height:.96;letter-spacing:-.055em;background:linear-gradient(110deg,#fff 15%,#ffd6ca 48%,#c8bdff 82%);-webkit-background-clip:text;background-clip:text;color:transparent}
    .hero-desc{max-width:720px;margin:24px 0 0;color:#d4d5f5;font-size:clamp(16px,2vw,20px);line-height:1.65}
    .hero-actions{display:flex;gap:11px;flex-wrap:wrap;margin-top:30px}
    .hero-btn{display:inline-flex;align-items:center;gap:10px;padding:13px 17px;border-radius:14px;text-decoration:none;color:#fff;font-size:13px;font-weight:800;border:1px solid rgba(255,255,255,.13);background:rgba(255,255,255,.06);transition:.2s ease}
    .hero-btn.primary{background:linear-gradient(135deg,#ff6a3d,#ef486f);box-shadow:0 14px 34px rgba(255,80,70,.24)}
    .hero-btn:hover{transform:translateY(-2px);border-color:rgba(255,255,255,.28)}
    .hero-stats{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:1px;margin-top:48px;border:1px solid rgba(255,255,255,.09);border-radius:22px;overflow:hidden;clip-path:inset(0 round 22px);background:rgba(255,255,255,.08)}
    .stat{padding:18px 20px;background:rgba(7,7,17,.72);backdrop-filter:blur(12px)}
    .stat strong{display:block;color:#fff;font-size:26px;line-height:1}
    .stat span{display:block;margin-top:7px;color:var(--muted);font-size:11px;text-transform:uppercase;letter-spacing:.1em}
    .live-note{position:absolute;top:25px;right:28px;display:flex;align-items:center;gap:8px;color:var(--muted);font-size:11px}
    .live-note:before{content:"";width:8px;height:8px;border-radius:50%;background:var(--ok);box-shadow:0 0 18px var(--ok);animation:pulse 2s ease-in-out infinite}
    @keyframes pulse{50%{opacity:.45;transform:scale(.8)}}
    .lang-label{
      color:var(--muted);
      font-size:12px;
      padding:0 6px 0 8px;
      white-space:nowrap;
    }
    .lang-btn{
      appearance:none;
      border:none;
      text-decoration:none;
      color:var(--text);
      font-size:12px;
      line-height:1;
      padding:9px 12px;
      border-radius:999px;
      background: transparent;
      transition: background .15s ease, transform .12s ease, color .15s ease;
      border:1px solid transparent;
    }
    .lang-btn:hover{
      background: rgba(255,255,255,.06);
      transform: translateY(-1px);
    }
    .lang-btn.active{
      background: linear-gradient(135deg, rgba(255,106,61,.22), rgba(124,92,255,.22));
      border-color: rgba(255,255,255,.12);
      color:#fff;
      box-shadow: 0 6px 20px rgba(0,0,0,.18);
    }

    .grid{
      margin-top:18px;
      display:grid;
      grid-template-columns: repeat(12, 1fr);
      gap:14px;
    }
    .section{
      grid-column: 1 / -1;
      padding:18px;
      border-radius: var(--radius);
      border:1px solid rgba(255,255,255,.08);
      background: linear-gradient(180deg, rgba(255,255,255,.04), rgba(255,255,255,.02));
      box-shadow: var(--shadow);
    }
    .section h2{
      margin:0 0 10px;
      font-size:15px;
      letter-spacing:.2px;
      display:flex; align-items:center; gap:10px;
    }
    .badge{
      font-size:11px;
      padding:3px 8px;
      border-radius:999px;
      border:1px solid rgba(255,255,255,.12);
      background: rgba(255,106,61,.12);
      color: #ffd5c8;
    }
    .sub{
      margin:0 0 12px;
      color: var(--muted);
      font-size:13px;
    }

    .cards{
      display:grid;
      grid-template-columns: repeat(12, 1fr);
      gap:14px;
    }
    .card{
      grid-column: span 6;
      padding:18px;
      border-radius:22px;
      border:1px solid rgba(255,255,255,.10);
      background: linear-gradient(180deg, var(--card), var(--card2));
      box-shadow: var(--shadow);
      position:relative;
      overflow:hidden;
      transition: transform .12s ease, border-color .12s ease;
    }
    .card:hover{transform: translateY(-2px); border-color: rgba(255,255,255,.18)}
    .card:before{
      content:"";
      position:absolute; inset:-1px;
      background: radial-gradient(380px 160px at 20% 0%, rgba(255,106,61,.16), transparent 58%),
                  radial-gradient(380px 160px at 90% 0%, rgba(124,92,255,.14), transparent 58%);
      pointer-events:none;
    }
    .card > *{position:relative}
    .card-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px}
    .version-links{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;margin-top:16px}
    .channel-link,.channel-unavailable{
      min-width:0;
      display:grid;
      grid-template-columns:minmax(0,1fr) auto;
      grid-template-areas:"label arrow" "version arrow";
      align-items:center;
      gap:2px 10px;
      padding:11px 13px;
      border:1px solid rgba(255,255,255,.12);
      border-radius:15px;
      color:var(--text);
      text-decoration:none;
      background:rgba(0,0,0,.20);
      transition:transform .12s ease,border-color .12s ease,background .12s ease;
    }
    .channel-link:hover{transform:translateY(-1px);border-color:rgba(255,255,255,.28);background:rgba(255,255,255,.07)}
    .channel-link.stable{background:linear-gradient(135deg,rgba(85,255,167,.11),rgba(0,0,0,.20))}
    .channel-link.snapshot{background:linear-gradient(135deg,rgba(124,92,255,.16),rgba(0,0,0,.20))}
    .channel-label{grid-area:label;color:var(--muted);font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:.09em}
    .channel-version{grid-area:version;overflow:hidden;text-overflow:ellipsis;color:#fff;font:700 12px/1.4 ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,"Liberation Mono",monospace;white-space:nowrap}
    .channel-arrow{grid-area:arrow;color:#fff;font-size:14px}
    .channel-unavailable{opacity:.55}
    .special-tools{margin-top:14px;padding:14px;border:1px solid rgba(124,92,255,.23);border-radius:17px;background:linear-gradient(135deg,rgba(124,92,255,.12),rgba(255,106,61,.07))}
    .special-tools-head{display:flex;align-items:center;gap:8px;margin-bottom:10px;color:#ded9ff;font-size:11px;font-weight:800;letter-spacing:.08em;text-transform:uppercase}
    .special-tools-head:before{content:"✦";color:#b5a8ff;font-size:14px}
    .tool-list{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}
    .tool-card{min-width:0;padding:12px;border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(7,7,17,.38)}
    .tool-name{margin:0;color:#fff;font-size:13px;font-weight:800}
    .tool-desc{margin:3px 0 10px;color:var(--muted);font-size:11px}
    .tool-actions{display:flex;gap:7px;flex-wrap:wrap}
    .tool-actions a{display:inline-flex;align-items:center;gap:5px;padding:6px 9px;border:1px solid rgba(255,255,255,.12);border-radius:10px;color:#fff;text-decoration:none;font-size:10px;font-weight:800;transition:transform .12s ease,border-color .12s ease,background .12s ease}
    .tool-actions a:hover{transform:translateY(-1px);border-color:rgba(255,255,255,.28);background:rgba(255,255,255,.07)}
    .tool-actions .stable{color:#bfffdc}
    .tool-actions .snapshot{color:#d4cdff}
    .name{font-weight:650; font-size:15px; margin:0}
    .meta{margin-top:2px;color:var(--muted);font-size:12px}
    .arrow{
      width:34px;height:34px;border-radius:12px;
      border:1px solid rgba(255,255,255,.12);
      background: rgba(0,0,0,.18);
      display:grid; place-items:center;
      flex:0 0 auto;
    }
    .arrow svg{opacity:.9}
    .smallgrid{
      display:grid;
      grid-template-columns: repeat(12, 1fr);
      gap:12px;
      margin-top:12px;
    }
    .item{
      grid-column: span 4;
      padding:14px;
      border-radius: 16px;
      border:1px solid rgba(255,255,255,.10);
      background: rgba(0,0,0,.18);
      transition: transform .12s ease, border-color .12s ease;
    }
    .item:hover{transform: translateY(-2px); border-color: rgba(255,255,255,.18)}
    .item a{color:inherit;text-decoration:none;display:block}
    .item .t{font-weight:650;margin:0}
    .item .d{margin:6px 0 0;color:var(--muted);font-size:12px}
    .item .u{margin:10px 0 0;color:#cfe0ff;font-size:12px;opacity:.9}

    .repo-layout{
      display:grid;
      grid-template-columns: 280px minmax(0,1fr);
      gap:14px;
      align-items:start;
      margin-top:12px;
    }
    .repo-sidebar{
      border:1px solid rgba(255,255,255,.10);
      border-radius:18px;
      background: rgba(0,0,0,.18);
      padding:10px;
      position:sticky;
      top:16px;
    }
    .repo-tabs{
      display:flex;
      flex-direction:column;
      gap:8px;
    }
    .repo-tab{
      display:block;
      padding:12px 13px;
      border-radius:14px;
      text-decoration:none;
      color:var(--text);
      border:1px solid rgba(255,255,255,.08);
      background: rgba(255,255,255,.02);
      transition: transform .12s ease, border-color .12s ease, background .12s ease;
    }
    .repo-tab:hover{
      transform: translateY(-1px);
      border-color: rgba(255,255,255,.16);
      background: rgba(255,255,255,.05);
    }
    .repo-tab.active{
      background: linear-gradient(135deg, rgba(255,106,61,.16), rgba(124,92,255,.16));
      border-color: rgba(255,255,255,.14);
      box-shadow: 0 8px 24px rgba(0,0,0,.18);
    }
    .repo-tab .repo-name{
      font-weight:650;
      margin:0;
      font-size:14px;
    }
    .repo-tab .repo-desc{
      margin:5px 0 0;
      color:var(--muted);
      font-size:12px;
    }

    .repo-view{
      min-width:0;
      border:1px solid rgba(255,255,255,.10);
      border-radius:18px;
      background: linear-gradient(180deg, var(--card), var(--card2));
      overflow:hidden;
      box-shadow: var(--shadow);
    }
    .repo-head{
      display:flex;
      gap:12px;
      justify-content:space-between;
      align-items:flex-start;
      padding:16px 16px 14px;
      border-bottom:1px solid rgba(255,255,255,.08);
      background: linear-gradient(180deg, rgba(255,255,255,.06), rgba(255,255,255,.02));
    }
    .repo-head h3{
      margin:0;
      font-size:17px;
    }
    .repo-head .repo-meta{
      margin-top:5px;
      color:var(--muted);
      font-size:12px;
    }
    .repo-actions{
      display:flex;
      gap:8px;
      flex-wrap:wrap;
      justify-content:flex-end;
    }
    .repo-btn{
      display:inline-flex;
      gap:8px;
      align-items:center;
      padding:10px 12px;
      border-radius:999px;
      text-decoration:none;
      color:var(--text);
      border:1px solid rgba(255,255,255,.10);
      background: rgba(0,0,0,.22);
      font-size:12px;
      white-space:nowrap;
    }
    .repo-btn:hover{
      border-color: rgba(255,255,255,.18);
      background: rgba(255,255,255,.05);
    }

    .repo-readme{
      padding:18px;
      max-height: 78vh;
      overflow:auto;
    }

    .markdown{
      color:var(--text);
    }
    .markdown > :first-child{margin-top:0}
    .markdown > :last-child{margin-bottom:0}
    .markdown h1,
    .markdown h2,
    .markdown h3,
    .markdown h4,
    .markdown h5,
    .markdown h6{
      margin:1.35em 0 .55em;
      line-height:1.2;
      letter-spacing:.1px;
    }
    .markdown h1{font-size:30px}
    .markdown h2{font-size:24px}
    .markdown h3{font-size:20px}
    .markdown h4{font-size:17px}
    .markdown p{
      margin:0 0 1em;
      color:#f1f2ff;
    }
    .markdown ul{
      margin:0 0 1em 1.2em;
      padding:0;
    }
    .markdown li{
      margin:.35em 0;
    }
    .markdown a{
      color:#cfe0ff;
      text-decoration:none;
      border-bottom:1px dashed rgba(207,224,255,.35);
    }
    .markdown a:hover{
      border-bottom-color: rgba(207,224,255,.8);
    }
    .markdown code{
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace;
      font-size:.92em;
      padding:.18em .38em;
      border-radius:8px;
      background: rgba(255,255,255,.08);
      border:1px solid rgba(255,255,255,.08);
    }
    .markdown pre{
      margin:1em 0;
      padding:14px;
      border-radius:14px;
      overflow:auto;
      background:#0a0b15;
      border:1px solid rgba(255,255,255,.08);
      box-shadow: inset 0 1px 0 rgba(255,255,255,.03);
    }
    .markdown pre code{
      padding:0;
      border:none;
      background:transparent;
      font-size:13px;
      line-height:1.55;
    }
    .markdown blockquote{
      margin:1em 0;
      padding:10px 14px;
      border-left:3px solid rgba(255,106,61,.65);
      background: rgba(255,255,255,.03);
      border-radius: 0 12px 12px 0;
      color: var(--muted);
    }
    .markdown hr{
      border:none;
      border-top:1px solid rgba(255,255,255,.08);
      margin:1.4em 0;
    }
    .md-table-wrap{
      overflow:auto;
      margin:1em 0;
      border:1px solid rgba(255,255,255,.08);
      border-radius:14px;
    }
    .md-table{
      width:100%;
      border-collapse:collapse;
      min-width:420px;
      background: rgba(0,0,0,.12);
    }
    .md-table th,
    .md-table td{
      padding:10px 12px;
      border-bottom:1px solid rgba(255,255,255,.08);
      text-align:left;
      vertical-align:top;
    }
    .md-table th{
      background: rgba(255,255,255,.05);
      color:#fff;
      font-weight:650;
    }
    .md-table tr:last-child td{
      border-bottom:none;
    }

    footer{
      margin-top:18px;
      color: var(--muted);
      font-size:12px;
      text-align:center;
      opacity:.9;
    }
    footer:after{content:"Kitsune Suite · built in the open"}
    code{
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace;
    }
    @media (max-width: 980px){
      .repo-layout{
        grid-template-columns: 1fr;
      }
      .repo-sidebar{
        position:static;
      }
      .repo-tabs{
        flex-direction:row;
        flex-wrap:wrap;
      }
      .repo-tab{
        flex:1 1 220px;
      }
      .repo-readme{
        max-height:none;
      }
    }
    @media (max-width: 860px){
      .card{grid-column: span 12}
      .item{grid-column: span 12}
      header{
        flex-direction:column;
        align-items:flex-start;
      }
      .right{
        width:100%;
      }
      .lang-switch{
        width:100%;
        justify-content:flex-start;
        flex-wrap:wrap;
        border-radius:18px;
      }
      .repo-head{
        flex-direction:column;
      }
      .repo-actions{
        justify-content:flex-start;
      }
      .top-nav{display:none}
      .hero{padding:60px 24px 30px}
      .hero-stats{grid-template-columns:1fr;border-radius:18px;clip-path:inset(0 round 18px)}
      .version-links{grid-template-columns:1fr}
      .tool-list{grid-template-columns:1fr}
      .live-note{left:24px;right:auto;top:22px}
    }
    @media (prefers-reduced-motion:reduce){html{scroll-behavior:auto}.hero:before,.hero:after,.live-note:before{animation:none}.card,.item,.hero-btn{transition:none}}
  </style>
</head>
<body>
  <div class="wrap">
    <header>
      <div class="brand">
        <div class="logo" aria-hidden="true"></div>
        <div>
          <h1><?= htmlspecialchars($title) ?></h1>
          <div class="tag"><?= htmlspecialchars($tagline) ?></div>
        </div>
      </div>

      <div class="right">
        <nav class="top-nav" aria-label="Primary">
          <a href="#libraries"><?= htmlspecialchars(tr($t, 'nav_docs')) ?></a>
          <a href="#repositories"><?= htmlspecialchars(tr($t, 'nav_repos')) ?></a>
        </nav>
        <nav class="lang-switch" aria-label="<?= htmlspecialchars(tr($t, 'lang_label')) ?>">
          <span class="lang-label"><?= htmlspecialchars(tr($t, 'lang_label')) ?>:</span>

          <a
            class="lang-btn <?= $lang === 'pl' ? 'active' : '' ?>"
            href="<?= htmlspecialchars(build_lang_url('pl')) ?>"
            hreflang="pl"
            lang="pl"
          >
            <?= htmlspecialchars(tr($i18n['pl'], 'lang_pl')) ?>
          </a>

          <a
            class="lang-btn <?= $lang === 'en' ? 'active' : '' ?>"
            href="<?= htmlspecialchars(build_lang_url('en')) ?>"
            hreflang="en"
            lang="en"
          >
            <?= htmlspecialchars(tr($i18n['en'], 'lang_en')) ?>
          </a>
        </nav>
      </div>
    </header>

    <section class="hero" aria-labelledby="hero-title">
      <div class="live-note"><?= htmlspecialchars(tr($t, 'live_catalog')) ?></div>
      <div class="hero-copy">
        <p class="eyebrow"><?= htmlspecialchars(tr($t, 'eyebrow')) ?></p>
        <h2 id="hero-title"><?= htmlspecialchars(tr($t, 'hero_title')) ?></h2>
        <p class="hero-desc"><?= htmlspecialchars(tr($t, 'hero_desc')) ?></p>
        <div class="hero-actions">
          <a class="hero-btn primary" href="#libraries"><?= htmlspecialchars(tr($t, 'explore_docs')) ?> <span aria-hidden="true">↓</span></a>
          <a class="hero-btn" href="#repositories"><?= htmlspecialchars(tr($t, 'explore_repos')) ?> <span aria-hidden="true">↗</span></a>
        </div>
      </div>
      <div class="hero-stats" aria-label="Showcase statistics">
        <div class="stat"><strong><?= $publishedLibraryCount ?></strong><span><?= htmlspecialchars(tr($t, 'stat_libraries')) ?></span></div>
        <div class="stat"><strong><?= $openRepositoryCount ?></strong><span><?= htmlspecialchars(tr($t, 'stat_repositories')) ?></span></div>
        <div class="stat"><strong>2</strong><span><?= htmlspecialchars(tr($t, 'stat_channels')) ?></span></div>
      </div>
    </section>

    <div class="grid">
      <section class="section" id="libraries">
        <h2><?= htmlspecialchars(tr($t, 'libraries')) ?></h2>
        <p class="sub">
          <?= htmlspecialchars(tr($t, 'generated_from')) ?> <code>/docs</code>.
        </p>

        <?php if (empty($cards)): ?>
          <div class="card" style="grid-column:1/-1">
            <p class="name"><?= htmlspecialchars(tr($t, 'empty_title')) ?></p>
            <div class="meta"><?= htmlspecialchars(tr($t, 'empty_desc')) ?></div>
          </div>
        <?php else: ?>
          <div class="cards">
            <?php foreach ($cards as $c): ?>
              <div class="card">
                <div class="card-head">
                  <div>
                    <p class="name"><?= htmlspecialchars($c['title']) ?></p>
                    <div class="meta">
                      <?= htmlspecialchars(tr($t, 'folder')) ?>: <code><?= htmlspecialchars($c['folder']) ?></code>
                      · <?= htmlspecialchars(tr($t, 'last_change')) ?>: <?= htmlspecialchars(fmt_date((int)$c['mtime'])) ?>
                    </div>
                  </div>
                </div>
                <div class="version-links" aria-label="<?= htmlspecialchars(tr($t, 'choose_version')) ?>">
                  <?php foreach (['stable', 'snapshot'] as $channel): ?>
                    <?php $channelUrl = $c[$channel . '_url']; $channelVersion = $c[$channel . '_version']; ?>
                    <?php if ($channelUrl): ?>
                      <a class="channel-link <?= htmlspecialchars($channel) ?>" href="<?= htmlspecialchars($channelUrl) ?>" target="_blank" rel="noopener" title="<?= htmlspecialchars(tr($t, 'open_in_new_tab')) ?>">
                        <span class="channel-label"><?= htmlspecialchars(tr($t, $channel)) ?></span>
                        <strong class="channel-version"><?= htmlspecialchars($channelVersion !== '' ? $channelVersion : tr($t, 'version_unavailable')) ?></strong>
                        <span class="channel-arrow" aria-hidden="true">↗</span>
                      </a>
                    <?php else: ?>
                      <div class="channel-unavailable">
                        <span class="channel-label"><?= htmlspecialchars(tr($t, $channel)) ?></span>
                        <strong class="channel-version"><?= htmlspecialchars(tr($t, 'version_unavailable')) ?></strong>
                      </div>
                    <?php endif; ?>
                  <?php endforeach; ?>
                </div>
                <?php if (!empty($c['tools'])): ?>
                  <div class="special-tools">
                    <div class="special-tools-head"><?= htmlspecialchars(tr($t, 'ks_subtitle')) ?></div>
                    <div class="tool-list">
                      <?php foreach ($c['tools'] as $tool): ?>
                        <div class="tool-card">
                          <p class="tool-name"><?= htmlspecialchars(tr($t, $tool['label_key'])) ?></p>
                          <p class="tool-desc"><?= htmlspecialchars(tr($t, $tool['description_key'])) ?></p>
                          <div class="tool-actions">
                            <?php if ($tool['stable_url']): ?><a class="stable" href="<?= htmlspecialchars($tool['stable_url']) ?>" target="_blank" rel="noopener"><?= htmlspecialchars(tr($t, 'stable')) ?> ↗</a><?php endif; ?>
                            <?php if ($tool['snapshot_url']): ?><a class="snapshot" href="<?= htmlspecialchars($tool['snapshot_url']) ?>" target="_blank" rel="noopener"><?= htmlspecialchars(tr($t, 'snapshot')) ?> ↗</a><?php endif; ?>
                          </div>
                        </div>
                      <?php endforeach; ?>
                    </div>
                  </div>
                <?php endif; ?>
              </div>
            <?php endforeach; ?>
          </div>
        <?php endif; ?>
      </section>

      <section class="section" id="repositories">
        <h2><?= htmlspecialchars(tr($t, 'repos_title')) ?></h2>
        <p class="sub"><?= htmlspecialchars(tr($t, 'repos_subtitle')) ?></p>

        <?php if (empty($repositories)): ?>
          <div class="card" style="grid-column:1/-1">
            <p class="name"><?= htmlspecialchars(tr($t, 'repo_empty')) ?></p>
          </div>
        <?php else: ?>
          <div class="repo-layout">
            <aside class="repo-sidebar">
              <div class="repo-tabs">
                <?php foreach ($repositories as $repo): ?>
                  <a
                    class="repo-tab <?= ($activeRepo && $activeRepo['slug'] === $repo['slug']) ? 'active' : '' ?>"
                    href="<?= htmlspecialchars(build_query_url(['repo' => $repo['slug']])) ?>"
                  >
                    <p class="repo-name"><?= htmlspecialchars($repo['label']) ?></p>
                    <?php if ($repo['description'] !== ''): ?>
                      <p class="repo-desc"><?= htmlspecialchars($repo['description']) ?></p>
                    <?php endif; ?>
                  </a>
                <?php endforeach; ?>
              </div>
            </aside>

            <div class="repo-view">
              <?php if ($activeRepo): ?>
                <div class="repo-head">
                  <div>
                    <h3><?= htmlspecialchars($activeRepo['label']) ?></h3>
                    <div class="repo-meta">
                      <?= htmlspecialchars(tr($t, 'repo_branch')) ?>: <code><?= htmlspecialchars($activeRepo['branch']) ?></code>
                      · <?= htmlspecialchars(tr($t, 'repo_updated')) ?>: <?= htmlspecialchars(fmt_date((int)$activeRepo['fetched_at'])) ?>
                    </div>
                  </div>

                  <div class="repo-actions">
                    <a class="repo-btn" href="<?= htmlspecialchars($activeRepo['github_url']) ?>" target="_blank" rel="noopener">
                      <?= htmlspecialchars(tr($t, 'repo_open_github')) ?>
                    </a>
                    <?php if (!empty($activeRepo['raw_url'])): ?>
                      <a class="repo-btn" href="<?= htmlspecialchars((string)$activeRepo['raw_url']) ?>" target="_blank" rel="noopener">
                        <?= htmlspecialchars(tr($t, 'repo_raw')) ?>
                      </a>
                    <?php endif; ?>
                  </div>
                </div>

                <div class="repo-readme">
                  <?php if ($activeRepo['ok'] && $activeRepo['readme_html'] !== ''): ?>
                    <div class="markdown">
                      <?= $activeRepo['readme_html'] ?>
                    </div>
                  <?php else: ?>
                    <div class="card" style="grid-column:1/-1">
                      <p class="name"><?= htmlspecialchars(tr($t, 'repo_error')) ?></p>
                      <div class="meta">
                        <code><?= htmlspecialchars($activeRepo['owner'] . '/' . $activeRepo['repo']) ?></code>
                      </div>
                    </div>
                  <?php endif; ?>
                </div>
              <?php endif; ?>
            </div>
          </div>
        <?php endif; ?>
      </section>
      <footer></footer>
    </div>
  </div>
</body>
</html>
