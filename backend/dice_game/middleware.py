from django.utils.deprecation import MiddlewareMixin
from django.conf import settings
import logging
import re

logger = logging.getLogger('django')

class NormalizePathMiddleware(MiddlewareMixin):
    """Middleware to normalize double slashes in paths to single slashes."""
    def process_request(self, request):
        if '//' in request.path:
            old_path = request.path
            new_path = re.sub(r'/+', '/', request.path)
            request.path = new_path
            
            if hasattr(request, 'path_info'):
                request.path_info = re.sub(r'/+', '/', request.path_info)
            
            logger.info(f"Normalized path from {old_path} to {new_path}")
        return None

class DisableCSRFMiddleware(MiddlewareMixin):
    """Middleware to disable CSRF for all API endpoints."""
    def process_request(self, request):
        # Always normalize for the check
        normalized_path = re.sub(r'/+', '/', request.path)
        
        # Log all POST requests to see what's being blocked
        if request.method == 'POST':
            logger.info(f"POST Request received for: {normalized_path}")
        
        if normalized_path.startswith('/api/'):
            # This flag tells Django's CSRF middleware to skip the check
            setattr(request, '_dont_enforce_csrf_checks', True)
            logger.info(f"CSRF exempt: {normalized_path}")
        return None
