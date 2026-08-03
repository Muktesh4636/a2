"""
URL configuration for dice_game project.
All URLs consolidated into a single file.
"""
from django.contrib import admin
from django.urls import path, re_path, include

# Clear Django admin branding so it's obvious this is the database admin
admin.site.site_header = "Gundu Ata — Database Admin"
admin.site.site_title = "Gundu Ata Admin"
admin.site.index_title = "Database tables & models"
from django.views.generic import RedirectView
from django.conf import settings
from django.conf.urls.static import static
from django.views.static import serve
from rest_framework_simplejwt.views import TokenVerifyView
from . import views as project_views

# Import all views
from accounts import views as accounts_views
from accounts import handoff as handoff_views
from game import views as game_views
from game import admin_views as game_admin_views
from game import cricket_views
from game import roulette_views
from game import trading_views
from game import chicken_road_views
from game import chicken_road2_views
from game import vortex_views

urlpatterns = [
    # APK Download endpoints (MUST come first, before everything else)
    # Using paths with file extensions that won't be caught by React routing
    # Include both with and without trailing slashes to handle Django's APPEND_SLASH
    path('gundu-ata.apk', project_views.download_apk, name='download_apk'),
    path('gundu-ata.apk/', project_views.download_apk, name='download_apk_slash'),
    path('app.apk', project_views.download_apk, name='download_apk_file'),
    path('app.apk/', project_views.download_apk, name='download_apk_file_slash'),
    path('download.apk', project_views.download_apk, name='download_apk_alt'),
    path('download.apk/', project_views.download_apk, name='download_apk_alt_slash'),
    # Also keep simple paths for convenience
    path('apk', project_views.download_apk, name='download_apk_simple'),
    path('apk/', project_views.download_apk, name='download_apk_simple_slash'),
    path('download-apk', project_views.download_apk, name='download_apk_dash'),
    path('download-apk/', project_views.download_apk, name='download_apk_dash_slash'),
    
    # Admin (must come before catch-all)
    path('admin/', admin.site.urls),
    # Media files (explicit so uploads like deposit_screenshots are always served by Django)
    re_path(r'^media/(?P<path>.*)$', serve, {'document_root': settings.MEDIA_ROOT}),
    path('api/', project_views.api_root, name='api_root'),
    path('api/health/', project_views.health, name='health'),
    path('api/time/', project_views.time_now, name='time_now'),
    # Maintenance status (public; works even when maintenance is on)
    path('api/maintenance/status/', project_views.maintenance_status, name='maintenance_status'),
    
    # Loading time endpoint (no authentication)
    path('api/loading-time/', accounts_views.loading_time, name='loading_time'),

    # Public support contacts (help center)
    path('api/support/contacts/', project_views.support_contacts, name='support_contacts'),
    
    # Auth endpoints (api/auth/)
    path('api/auth/register/', accounts_views.register, name='register'),
    path('api/auth/register-agent/', accounts_views.register_agent, name='register_agent'),
    path('api/auth/login/', accounts_views.login, name='login'),
    path('api/auth/otp/send/', accounts_views.send_otp, name='send_otp'),
    path('api/auth/otp/verify-login/', accounts_views.verify_otp_login, name='verify_otp_login'),
    path('api/auth/token/refresh/', accounts_views.SingleSessionTokenRefreshView.as_view(), name='token_refresh'),
    path('api/auth/token/verify/', TokenVerifyView.as_view(), name='token_verify'),
    # Cross-app: one-time code (trusted backend) then exchange for JWT
    path('api/auth/handoff/create/', handoff_views.handoff_create, name='handoff_create'),
    path('api/auth/handoff/exchange/', handoff_views.handoff_exchange, name='handoff_exchange'),
    path('api/auth/profile/', accounts_views.profile, name='profile'),
    path('api/auth/profile/photo/', accounts_views.update_profile_photo, name='update_profile_photo'),
    path('api/auth/referral-data/', accounts_views.referral_data, name='referral_data'),
    path('api/auth/wallet/', accounts_views.WalletView.as_view(), name='wallet'),
    path('api/auth/transactions/', accounts_views.TransactionList.as_view(), name='transactions'),
    path('api/auth/extract-utr/', accounts_views.extract_utr, name='extract_utr'),
    path('api/auth/process-screenshot/', accounts_views.process_payment_screenshot, name='process_payment_screenshot'),
    path('api/auth/deposits/initiate/', accounts_views.initiate_deposit, name='initiate_deposit'),
    path('api/auth/deposits/upload-proof/', accounts_views.upload_deposit_proof, name='upload_deposit_proof'),
    path('api/auth/deposits/submit-utr/', accounts_views.submit_utr, name='submit_utr'),
    path('api/auth/deposits/mine/', accounts_views.my_deposit_requests, name='my_deposit_requests'),
    path('api/auth/deposits/pending/', accounts_views.pending_deposit_requests, name='pending_deposit_requests'),
    path('api/auth/deposits/<int:pk>/approve/', accounts_views.approve_deposit_request, name='approve_deposit_request'),
    path('api/auth/deposits/<int:pk>/reject/', accounts_views.reject_deposit_request, name='reject_deposit_request'),
    path('api/auth/withdraws/initiate/', accounts_views.initiate_withdraw, name='initiate_withdraw'),
    path('api/auth/withdraws/mine/', accounts_views.my_withdraw_requests, name='my_withdraw_requests'),
    path('api/auth/payment-methods/', accounts_views.get_payment_methods, name='get_payment_methods'),
    path('api/auth/bank-details/', accounts_views.my_bank_details, name='my_bank_details'),
    path('api/auth/bank-details/<int:pk>/', accounts_views.bank_detail_action, name='bank_detail_action'),
    path('api/auth/daily-reward/', accounts_views.daily_reward, name='daily_reward'),
    path('api/auth/daily-reward/history/', accounts_views.daily_reward_history, name='daily_reward_history'),
    path('api/auth/lucky-draw/', accounts_views.lucky_draw, name='lucky_draw'),
    path('api/auth/leaderboard/', accounts_views.leaderboard, name='leaderboard'),
    path('api/auth/register-fcm-token/', accounts_views.register_fcm_token, name='register_fcm_token'),
    path('api/auth/password/reset/', accounts_views.reset_password, name='reset_password'),
    path('api/auth/password/change/', accounts_views.change_password, name='change_password'),
    
    # APK Download via API (guaranteed to work since API routes come before React)
    path('api/download/apk/', project_views.download_apk, name='api_download_apk'),
    path('api/apk/', project_views.download_apk, name='api_apk'),

    # White-label lead capture (public)
    path('api/whitelabel/lead/', project_views.white_label_lead, name='white_label_lead'),
    # Client payments: ending payment (pending commission) per user — for client-payments app
    path('api/client-payments/ending-payment/<int:user_id>/', game_views.ending_payment_for_user, name='ending_payment_for_user'),
    # Game settings API (explicit so it always resolves even if include order or proxy differs)
    path('api/game/settings/', game_views.game_settings_api, name='game_settings_api_direct'),
    path('api/game/settings', game_views.game_settings_api, name='game_settings_api_direct_no_slash'),
    # ----------------------------------------------------------------
    # Cricket live data proxy (public — no auth required)
    # ----------------------------------------------------------------
    path('api/cricket/matches/',               cricket_views.cricket_match_list,     name='cricket_match_list'),
    path('api/cricket/matches/<int:match_id>/', cricket_views.cricket_match_detail, name='cricket_match_detail'),
    path('api/cricket/upcoming/',              cricket_views.cricket_upcoming_matches, name='cricket_upcoming_matches'),
    path('api/cricket/live-matches/', cricket_views.cricket_live_matches,   name='cricket_live_matches'),
    path('api/cricket/scores/',       cricket_views.cricket_scores,         name='cricket_scores'),
    path('api/cricket/opensource-scores/', cricket_views.cricket_opensource_scores, name='cricket_opensource_scores'),
    path('api/cricket/odds/',         cricket_views.cricket_odds,           name='cricket_odds'),
    path('api/cricket/changes/',      cricket_views.cricket_live_changes,   name='cricket_live_changes'),
    path('api/cricket/markets/',      cricket_views.cricket_markets,        name='cricket_markets'),
    path('api/cricket/all-live-events/', cricket_views.cricket_all_live_events, name='cricket_all_live_events'),
    path('api/cricket/sync-status/',     cricket_views.cricket_sync_status,     name='cricket_sync_status'),
    path('api/cricket/bet/',             cricket_views.place_cricket_bet,       name='place_cricket_bet'),
    path('api/cricket/bets/',            cricket_views.my_cricket_bets,         name='my_cricket_bets'),
    path('api/cricket/results/',         cricket_views.cricket_results,         name='cricket_results'),
    path('api/cricket/settle/',          cricket_views.cricket_settle_now,      name='cricket_settle_now'),

    # Colour game endpoints
    path('api/colour/round/', game_views.colour_round_status, name='colour_round_status'),
    path('api/colour/bet/', game_views.colour_place_bet, name='colour_place_bet'),
    path('api/colour/round/<str:round_id>/result/', game_views.colour_round_result, name='colour_round_result'),
    path('api/colour/bets/', game_views.colour_my_bets, name='colour_my_bets'),
    path('api/colour/results/', game_views.colour_recent_results, name='colour_recent_results'),

    # Roulette — real JWT + wallet only (no guest sessions)
    path('api/roulette/me/', roulette_views.roulette_me, name='roulette_me'),
    path('api/roulette/state/', roulette_views.roulette_state, name='roulette_state'),
    path('api/roulette/bets/', roulette_views.roulette_place_bet, name='roulette_place_bet'),
    path('api/roulette/bets/undo/', roulette_views.roulette_undo, name='roulette_undo'),
    path('api/roulette/bets/double/', roulette_views.roulette_double, name='roulette_double'),
    path('api/roulette/bets/clear/', roulette_views.roulette_clear, name='roulette_clear'),
    path('api/roulette/spin/', roulette_views.roulette_spin, name='roulette_spin'),
    path('api/roulette/history/', roulette_views.roulette_history, name='roulette_history'),


    # Trading (Grow More) — real JWT + wallet only (no demo)
    path('api/trading/me/', trading_views.trading_me, name='trading_me'),
    path('api/trading/state/', trading_views.trading_state, name='trading_state'),
    path('api/trading/bets/', trading_views.trading_place_bet, name='trading_place_bet'),
    path('api/trading/bets/undo/', trading_views.trading_undo, name='trading_undo'),
    path('api/trading/bets/cashout/', trading_views.trading_cashout, name='trading_cashout'),
    path('api/trading/history/', trading_views.trading_history, name='trading_history'),

    # Chicken Road (v1) — JWT + wallet
    path('api/chicken-road/config/', chicken_road_views.chicken_road_config, name='chicken_road_config'),
    path('api/chicken-road/me/', chicken_road_views.chicken_road_me, name='chicken_road_me'),
    path('api/chicken-road/start/', chicken_road_views.chicken_road_start, name='chicken_road_start'),
    path('api/chicken-road/<uuid:round_id>/', chicken_road_views.chicken_road_round, name='chicken_road_round'),
    path('api/chicken-road/<uuid:round_id>/go/', chicken_road_views.chicken_road_go, name='chicken_road_go'),
    path('api/chicken-road/<uuid:round_id>/cashout/', chicken_road_views.chicken_road_cashout, name='chicken_road_cashout'),

    # Chicken Road 2 — JWT + wallet
    path('api/chicken-road-2/config/', chicken_road2_views.chicken_road2_config, name='chicken_road2_config'),
    path('api/chicken-road-2/me/', chicken_road2_views.chicken_road2_me, name='chicken_road2_me'),
    path('api/chicken-road-2/start/', chicken_road2_views.chicken_road2_start, name='chicken_road2_start'),
    path('api/chicken-road-2/<uuid:round_id>/', chicken_road2_views.chicken_road2_round, name='chicken_road2_round'),
    path('api/chicken-road-2/<uuid:round_id>/step/', chicken_road2_views.chicken_road2_step, name='chicken_road2_step'),
    path('api/chicken-road-2/<uuid:round_id>/cashout/', chicken_road2_views.chicken_road2_cashout, name='chicken_road2_cashout'),
    path('api/chicken-road-2/<uuid:round_id>/forfeit/', chicken_road2_views.chicken_road2_forfeit, name='chicken_road2_forfeit'),

    # Vortex — JWT + wallet
    path('api/vortex/state/', vortex_views.vortex_state, name='vortex_state'),
    path('api/vortex/bet/', vortex_views.vortex_bet, name='vortex_bet'),
    path('api/vortex/spin/', vortex_views.vortex_spin, name='vortex_spin'),
    path('api/vortex/cashout/', vortex_views.vortex_cashout, name='vortex_cashout'),
    path('api/vortex/part/', vortex_views.vortex_part, name='vortex_part'),


    # Game endpoints (api/game/)
    path('api/game/', include('game.urls')),
    
    # Game admin endpoints (game-admin/)
    # Base game-admin path - redirect to login or dashboard based on auth status
    path('game-admin/', game_admin_views.admin_login, name='game_admin_root'),
    path('game-admin/login/', game_admin_views.admin_login, name='admin_login'),
    path('game-admin/logout/', game_admin_views.admin_logout, name='admin_logout'),
    # Redirect game-admin/admin/ -> Django admin (view DB tables)
    path('game-admin/admin/', RedirectView.as_view(url='/admin/', permanent=False), name='game_admin_to_django_admin'),
    path('game-admin/dashboard/', game_admin_views.admin_dashboard, name='admin_dashboard'),
    path('game-admin/games/', game_admin_views.admin_games, name='admin_games'),
    path('game-admin/games/<slug:game_slug>/', game_admin_views.admin_game_detail, name='admin_game_detail'),
    path('game-admin/games/<slug:game_slug>/round/<str:round_id>/', game_admin_views.admin_game_round, name='admin_game_round'),
    path('game-admin/dice-control/', game_admin_views.dice_control, name='dice_control'),
    path('game-admin/dice-controlled-rounds/', game_admin_views.dice_controlled_rounds, name='dice_controlled_rounds'),
    path('game-admin/recent-rounds/', game_admin_views.recent_rounds, name='recent_rounds'),
    path('game-admin/round/<str:round_id>/', game_admin_views.round_details, name='round_details'),
    path('game-admin/user/<int:user_id>/', game_admin_views.user_details, name='user_details'),
    path('game-admin/testing-dashboard/', game_admin_views.testing_dashboard, name='testing_dashboard'),
    path('game-admin/testing-dashboard/start/', game_admin_views.start_simulation, name='start_simulation'),
    path('game-admin/testing-dashboard/stop/', game_admin_views.stop_simulation, name='stop_simulation'),
    path('game-admin/testing-dashboard/status/', game_admin_views.simulation_status, name='simulation_status'),
    path('game-admin/all-bets/', game_admin_views.all_bets, name='all_bets'),
    path('game-admin/wallets/', game_admin_views.wallets, name='wallets'),
    path('game-admin/deposit-requests/', game_admin_views.deposit_requests, name='deposit_requests'),
    path('game-admin/deposit-requests/check-new/', game_admin_views.check_new_deposit_requests, name='check_new_deposit_requests'),
    path('game-admin/deposit-requests/<int:pk>/approve/', game_admin_views.approve_deposit, name='approve_deposit'),
    path('game-admin/deposit-requests/<int:pk>/reject/', game_admin_views.reject_deposit, name='reject_deposit'),
    path('game-admin/deposit-requests/<int:pk>/edit-amount/', game_admin_views.edit_deposit_amount, name='edit_deposit_amount'),
    path('game-admin/withdraw-requests/', game_admin_views.withdraw_requests, name='withdraw_requests'),
    path('game-admin/withdraw-requests/check-new/', game_admin_views.check_new_withdraw_requests, name='check_new_withdraw_requests'),
    path('game-admin/withdraw-requests/<int:pk>/approve/', game_admin_views.approve_withdraw, name='approve_withdraw'),
    path('game-admin/withdraw-requests/<int:pk>/complete-payment/', game_admin_views.complete_withdraw_payment, name='complete_withdraw_payment'),
    path('game-admin/withdraw-requests/<int:pk>/reject/', game_admin_views.reject_withdraw, name='reject_withdraw'),
    path('game-admin/reports/', game_admin_views.transactions, name='admin_transactions'),
    path('game-admin/dashboard-data/', game_admin_views.admin_dashboard_data, name='admin_dashboard_data'),
    path('game-admin/set-dice/', game_admin_views.set_dice_result_view, name='set_dice_result_view'),
    path('game-admin/set-individual-dice/', game_admin_views.set_individual_dice_view, name='set_individual_dice_view'),
    path('game-admin/toggle-dice-mode/', game_admin_views.toggle_dice_mode, name='toggle_dice_mode'),
    path('game-admin/players-list/', game_admin_views.manage_players, name='manage_players'),
    path('game-admin/players/create/', game_admin_views.create_player, name='create_player'),
    path('game-admin/players/', game_admin_views.players, name='players'),
    path('game-admin/players/assign-worker/', game_admin_views.assign_worker, name='assign_worker'),
    path('game-admin/game-settings/', game_admin_views.game_settings, name='game_settings'),
    path('game-admin/help-center/', game_admin_views.help_center, name='help_center'),
    path('game-admin/white-label/', game_admin_views.white_label_leads, name='white_label_leads'),
    path('game-admin/maintenance-toggle/', game_admin_views.maintenance_toggle, name='maintenance_toggle'),
    path('game-admin/logout-all-sessions/', game_admin_views.logout_all_sessions, name='logout_all_sessions'),
    path('game-admin/worker-management/', game_admin_views.admin_management, name='admin_management'),
    path('game-admin/worker-management/create/', game_admin_views.create_admin, name='create_admin'),
    path('game-admin/worker-management/<int:admin_id>/toggle-active/', game_admin_views.toggle_admin_status, name='toggle_admin_status'),
    path('game-admin/worker-management/edit/<int:admin_id>/', game_admin_views.edit_admin, name='edit_admin'),
    path('game-admin/worker-management/delete/<int:admin_id>/', game_admin_views.delete_admin, name='delete_admin'),
    path('game-admin/agents/', game_admin_views.agent_management, name='agent_management'),
    path('game-admin/agents/create/', game_admin_views.create_agent, name='create_agent'),
    path('game-admin/agents/<int:agent_id>/', game_admin_views.agent_details, name='agent_details'),
    path('game-admin/agents/<int:agent_id>/edit/', game_admin_views.edit_agent, name='edit_agent'),
    path('game-admin/agents/<int:agent_id>/toggle-active/', game_admin_views.toggle_agent_status, name='toggle_agent_status'),
    path('game-admin/franchise-balance/', game_admin_views.franchise_balance, name='franchise_balance'),
    path('game-admin/franchise-balance/details/<int:admin_id>/', game_admin_views.franchise_admin_details, name='franchise_admin_details'),
    path('game-admin/franchise-balance/details/<int:admin_id>/players/', game_admin_views.franchise_admin_players, name='franchise_admin_players'),
    path('game-admin/franchise-balance/edit/<int:admin_id>/', game_admin_views.edit_franchise_admin, name='edit_franchise_admin'),
    path('game-admin/franchise-balance/create/', game_admin_views.create_franchise_admin, name='create_franchise_admin'),
    
    # Payment Methods
    path('game-admin/profile/', game_admin_views.admin_profile, name='admin_profile'),
    path('game-admin/payment-methods/', game_admin_views.payment_methods, name='payment_methods'),
    path('game-admin/payment-methods/create/', game_admin_views.create_payment_method, name='create_payment_method'),
    path('game-admin/payment-methods/<int:pk>/edit/', game_admin_views.edit_payment_method, name='edit_payment_method'),
    path('game-admin/payment-methods/<int:pk>/delete/', game_admin_views.delete_payment_method, name='delete_payment_method'),
    path('game-admin/payment-methods/<int:pk>/toggle/', game_admin_views.toggle_payment_method, name='toggle_payment_method'),
    
    # Serve React static assets (assets/*)
    re_path(r'^assets/.*$', project_views.serve_react_app, name='react_assets'),
    
    # Root path - public website landing page
    path('', project_views.home, name='root'),
    
    # Catch-all route for React app (must be last)
    # This will serve the React app for all routes not matched above
    # Updated regex to properly match all paths except API/admin/static/media/ws/assets/apk/download paths
    # Handles potential double slashes and varying prefixes
    # Explicitly exclude download paths and .apk files
    re_path(r'^(?!/?api/|/?admin/|/?game-admin/|/?static/|/?media/|/?ws/|/?assets/|^apk$|^download-apk$|.*\.apk$).*', project_views.serve_react_app, name='react_app'),
]

# Serve static and media files (always in development, only static in production)
urlpatterns += static(settings.MEDIA_URL, document_root=settings.MEDIA_ROOT)
if settings.DEBUG:
    urlpatterns += static(settings.STATIC_URL, document_root=settings.STATIC_ROOT)
