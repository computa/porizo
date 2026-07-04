package com.porizo.app

import androidx.lifecycle.ViewModel
import com.porizo.core.media.PorizoPlayer
import dagger.hilt.android.lifecycle.HiltViewModel
import javax.inject.Inject

@HiltViewModel
class PlayerViewModel @Inject constructor(
    val player: PorizoPlayer,
) : ViewModel()
