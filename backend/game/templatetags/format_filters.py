"""Custom template filters for number/date formatting."""
from django import template

register = template.Library()


@register.filter
def staff_name(staff_user, viewer=None):
    """
    Username of a staff account, with the God account masked as 'System' for
    everyone else. Historical rows (e.g. processed_by) must not expose God.
    """
    if not staff_user:
        return ''
    from game.admin_utils import is_god
    if is_god(staff_user) and not is_god(viewer):
        return 'System'
    return staff_user.username


@register.filter
def indian_int(value):
    """Format integer with Indian-style commas (e.g. 12,34,567)."""
    if value is None:
        return '0'
    try:
        n = int(value)
    except (TypeError, ValueError):
        return '0'
    s = str(abs(n))
    if not s:
        return '0'
    if len(s) <= 3:
        return ('-' if n < 0 else '') + s
    groups = [s[-3:]]
    s = s[:-3]
    while s:
        groups.insert(0, s[-2:])
        s = s[:-2]
    result = ','.join(groups)
    return ('-' if n < 0 else '') + result
