package com.automaticdeposit.phonepesync

data class TxnSummary(
    val index: Int,
    val type: String,
    val party: String,
    val amount: String,
    val whenText: String = "",
)

data class TxnDetail(
    val index: Int,
    val status: String = "",
    val datetime: String = "",
    val type: String = "",
    val party: String = "",
    val amount: String = "",
    val upi_or_bank: String = "",
    val phonepe_txn_id: String = "",
    val utr: String = "",
    val debited_from: String = "",
) {
    fun toJsonObject(): org.json.JSONObject = org.json.JSONObject()
        .put("index", index)
        .put("status", status)
        .put("datetime", datetime)
        .put("type", type)
        .put("party", party)
        .put("amount", amount)
        .put("upi_or_bank", upi_or_bank)
        .put("phonepe_txn_id", phonepe_txn_id)
        .put("utr", utr)
        .put("debited_from", debited_from)
}
