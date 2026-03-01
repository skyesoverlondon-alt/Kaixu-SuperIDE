import re

with open('ide.html', 'r') as f:
    content = f.read()

# 1. Tab nav - add role="tablist"
content = content.replace(
    '<nav id="side-tabs">',
    '<nav id="side-tabs" role="tablist" aria-label="IDE panels">'
)

# 2. All tabBtns - add role="tab" (only those that don't have it yet)
content = re.sub(
    r'<button class="tabBtn([^"]*)"(?![^>]*role=)',
    r'<button class="tabBtn\1" role="tab"',
    content
)

# 3. Non-active tabs get aria-selected="false"
# First, fix any tabBtn that already has aria-selected="true" – leave it
# Add aria-selected="false" to role="tab" buttons that lack aria-selected
content = re.sub(
    r'(role="tab"(?![^<]*aria-selected))',
    r'role="tab" aria-selected="false"',
    content
)
# The files tab already has aria-selected="true" after the earlier fix;
# correct any case where both got added
content = content.replace('aria-selected="true" aria-selected="false"', 'aria-selected="true"')

# 4. Side pane containers – add role="tabpanel"
for pane_id in ['files-pane','chat-pane','scm-pane','tasks-pane',
                 'activity-pane','github-pane','outline-pane','problems-pane']:
    label = pane_id.replace('-pane','').title()
    content = content.replace(
        f'<div id="{pane_id}"',
        f'<div id="{pane_id}" role="tabpanel" aria-label="{label}"'
    )

# 5. All modals – add role="dialog" aria-modal="true"
content = re.sub(
    r'<div (id="[^"]*-modal"[^>]*class="modal-overlay[^"]*")(?![^>]*role=)',
    r'<div \1 role="dialog" aria-modal="true"',
    content
)
content = re.sub(
    r'<div (class="modal-overlay[^"]*"[^>]*id="[^"]*-modal")(?![^>]*role=)',
    r'<div \1 role="dialog" aria-modal="true"',
    content
)

# 6. aria-label on icon-only / title-only buttons
replacements = [
    ('id="search-panel-btn"',   'id="search-panel-btn" aria-label="Search workspace"'),
    ('id="split-btn"',          'id="split-btn" aria-label="Toggle split pane"'),
    ('id="cmd-palette-btn"',    'id="cmd-palette-btn" aria-label="Command palette"'),
    ('id="format-btn"',         'id="format-btn" aria-label="Format document"'),
    ('id="settings-btn"',       'id="settings-btn" aria-label="Settings"'),
    ('id="loop-mode-btn"',      'id="loop-mode-btn" aria-label="Loop mode"'),
    ('id="preview-toggle"',     'id="preview-toggle" aria-label="Toggle preview"'),
    ('id="preview-detach"',     'id="preview-detach" aria-label="Detach preview to new window"'),
    ('id="preview-new-tab-btn"','id="preview-new-tab-btn" aria-label="Open preview in new tab"'),
    ('id="scm-tags-btn"',       'id="scm-tags-btn" aria-label="Manage tags"'),
    ('id="scm-blame-btn"',      'id="scm-blame-btn" aria-label="Show file blame"'),
    ('id="scm-review-btn"',     'id="scm-review-btn" aria-label="Request code review"'),
    ('id="stash-push-btn"',     'id="stash-push-btn" aria-label="Stash current changes"'),
    ('id="task-refresh-btn"',   'id="task-refresh-btn" aria-label="Refresh tasks"'),
    ('id="activity-refresh-btn"','id="activity-refresh-btn" aria-label="Refresh activity"'),
    ('id="gh-refresh-btn"',     'id="gh-refresh-btn" aria-label="Refresh GitHub status"'),
    ('id="authBtn"',            'id="authBtn" aria-label="Sign in or manage account"'),
    ('id="help-btn"',           'id="help-btn" aria-label="Help and documentation"'),
    ('id="branch-manage-btn"',  'id="branch-manage-btn" aria-label="Manage branches"'),
    ('id="newOrgBtn"',          'id="newOrgBtn" aria-label="Create organization"'),
    ('id="newWsBtn"',           'id="newWsBtn" aria-label="Create workspace"'),
    ('id="share-preview-btn"',  'id="share-preview-btn" aria-label="Share workspace read-only link"'),
    ('id="admin-panel-btn"',    'id="admin-panel-btn" aria-label="Admin panel"'),
    ('id="agent-memory-btn"',   'id="agent-memory-btn" aria-label="Agent memory"'),
    ('id="watch-mode-btn"',     'id="watch-mode-btn" aria-label="Toggle watch mode"'),
    ('id="task-new-btn"',       'id="task-new-btn" aria-label="New task"'),
    ('id="deploy-btn"',         'id="deploy-btn" aria-label="Trigger Netlify deploy"'),
    ('id="demo-loader-btn"',    'id="demo-loader-btn" aria-label="Load a demo project"'),
    ('id="tutorial"',           'id="tutorial" aria-label="Open tutorial"'),
]
for old, new in replacements:
    content = content.replace(old, new, 1)

# 7. aria-label on selects
selects = [
    ('id="orgSelect"',           'id="orgSelect" aria-label="Select organization"'),
    ('id="wsSelect"',            'id="wsSelect" aria-label="Select workspace"'),
    ('id="chatScope"',           'id="chatScope" aria-label="Agent scope"'),
    ('id="toolMode"',            'id="toolMode" aria-label="Tool mode"'),
    ('id="branch-selector"',     'id="branch-selector" aria-label="Active branch"'),
    ('id="task-filter-status"',  'id="task-filter-status" aria-label="Filter by status"'),
    ('id="task-filter-priority"','id="task-filter-priority" aria-label="Filter by priority"'),
    ('id="problems-filter"',     'id="problems-filter" aria-label="Filter problems"'),
    ('id="template-select"',     'id="template-select" aria-label="Select template"'),
]
for old, new in selects:
    content = content.replace(old, new, 1)

# 8. aria-label on placeholder-only inputs
inputs = [
    ('id="commit-message"', 'id="commit-message" aria-label="Commit message"'),
    ('id="stash-message"',  'id="stash-message" aria-label="Stash message"'),
    ('id="loopCount"',      'id="loopCount" aria-label="Max loop iterations"'),
    ('id="outline-filter"', 'id="outline-filter" aria-label="Filter outline symbols"'),
    ('id="gh-commit-msg"',  'id="gh-commit-msg" aria-label="Commit message"'),
    ('id="preview-route"',  'id="preview-route" aria-label="Preview route"'),
    ('id="help-search"',    'id="help-search" aria-label="Search help topics"'),
    ('id="mfa-token-input"','id="mfa-token-input" aria-label="One-time password"'),
]
for old, new in inputs:
    content = content.replace(old, new, 1)

with open('ide.html', 'w') as f:
    f.write(content)

# Verify
checks = [
    ('role="tablist"', 'tablist on nav'),
    ('role="tab"', 'role=tab on tabBtns'),
    ('role="tabpanel"', 'role=tabpanel on panes'),
    ('role="dialog"', 'role=dialog on modals'),
    ('aria-modal="true"', 'aria-modal on modals'),
    ('aria-label=', 'aria-label on buttons/inputs'),
]
for pat, label in checks:
    count = content.count(pat)
    print(f'✓ {label}: {count} occurrences' if count else f'✗ MISSING {label}')
