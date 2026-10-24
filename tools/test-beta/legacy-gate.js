/* Loaded only into the beta artifact, before authenticated adapters capture originals. */
(() => {
 'use strict';
 if(window.IIG_TEST_BETA?.ready!==true)throw Error('TEST configuration required');
 const account=()=>window.iigAccount?.open();
 db=Object.freeze({rpc:async()=>({data:null,error:{message:'Legacy database operations are disabled. Use verified TEST sign-in.'}})});
 loadAdminForGroup=()=>{isAdmin=false;isOwner=false;ownerCreationCode='';};
 saveAdminForGroup=()=>{};
 loadMyPlayerForGroup=()=>{myPlayerId='';};
 adminDeviceRecognised=()=>false;
 adminPinForGroup=()=>null;
 adminPinEntryModal=async()=>false;
 organiserAdminPinSetup=async()=>{throw Error('Use verified TEST email sign-in; Admin PIN setup is disabled.');};
 adminLogin=account;
 adminLoginFromWaiting=account;
 openRememberedAdminFromWaiting=account;
 ownerLogin=()=>location.assign('/app/owner-dashboard.html');
 ownerResetAdminPin=account;
 changeAdminPin=account;
 chooseMyPlayer=account;
 notificationsAvailableForGroup=()=>false;
 notificationCardHtml=()=>'';
 enableIigNotifications=async()=>{};
 disableIigNotifications=async()=>{};
})();
